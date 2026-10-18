/**
 * Order worker — automatic provider submission + status synchronization.
 *
 * Architecture (Phase 2C-2):
 *
 *   1. Recover unsent orders  — orders that are `pending` with no `smmOrderId`,
 *      where the synchronous provider call in /api/services/order failed with a
 *      TRANSIENT/AMBIGUOUS error (or crashed mid-flight). The worker re-submits
 *      ONLY when the previous failure was definitively "not accepted" by the
 *      provider. For AMBIGUOUS outcomes (timeout/parse/network-reset AFTER the
 *      request may have reached the provider) it marks `needsReview` instead of
 *      blindly re-submitting — preventing duplicate provider orders.
 *
 *   2. Sync provider status    — for orders that already have an `smmOrderId`
 *      and a non-terminal local status, the worker polls the provider's status
 *      API and maps the provider's status string to the local OrderStatus enum.
 *
 * Safety primitives:
 *   - Atomic claim: `workerClaimUntil` prevents two workers processing the
 *     same order concurrently.
 *   - Bounded retry: `smmAttempts` + `nextRetryAt` implement capped exponential
 *     backoff; orders that exhaust attempts go to `needsReview`.
 *   - No blind retries on ambiguous outcomes.
 *   - Terminal statuses (completed/cancelled/failed) are NEVER overwritten.
 *   - The worker never debits wallets — it only submits to the provider and
 *     updates order status. Refunds reuse the existing atomic mechanism.
 */

import { Order, Service, Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import type { OrderStatus } from "@/db/mongodb-schema";
import { NotificationEventType, NotificationSeverity } from "@/db/mongodb-schema";
import { num } from "@/lib/api";
import {
  addOrder,
  getOrderStatus,
  isProviderConfigured,
  SmmApiError,
} from "@/lib/smm-client";
import {
  ambiguousResultKey,
  maxRetriesKey,
  needsReviewKey,
  permanentFailureKey,
  pollingFailedKey,
  sendNotification,
} from "@/lib/notifications";

export type SubmissionDisposition = "transient" | "permanent" | "ambiguous";

export type WorkerSummary = {
  due: number;
  claimed: number;
  submitted: number;
  scheduledRetry: number;
  failed: number;
  needsReview: number;
  skippedNoProvider: number;
  errors: string[];
};

function emptySummary(): WorkerSummary {
  return {
    due: 0,
    claimed: 0,
    submitted: 0,
    scheduledRetry: 0,
    failed: 0,
    needsReview: 0,
    skippedNoProvider: 0,
    errors: [],
  };
}

/** Max automatic submission attempts before parking for manual review. */
export const MAX_SUBMISSION_ATTEMPTS = 6;
/** Claim lease: a crashed worker's orders become eligible again after this. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;
/** Bounded backoff per attempt (1-based attempt number). */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000];

export const WORKER_BATCH_DEFAULT = 25;
export const WORKER_BATCH_MAX = 50;

function backoffForAttempt(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
}

// ---------------------------------------------------------------------------
// Admin notifications (Phase 2C-6) — best-effort, idempotent, never fatal.
//
// One LOGICAL event per order transition = ONE notification, guaranteed by the
// deterministic eventKey (unique index). Repeated scheduler ticks or duplicate
// worker executions for the same unchanged state therefore never duplicate a
// notification. A notification failure NEVER changes order/wallet/refund
// state: sendNotification swallows all errors and these helpers add a second
// isolation layer around the admin-recipient lookup.
// ---------------------------------------------------------------------------

export type OrderEventDecision = {
  eventType: (typeof NotificationEventType)[keyof typeof NotificationEventType];
  severity: (typeof NotificationSeverity)[keyof typeof NotificationSeverity];
  key: string;
  title: string;
  message: string;
};

/** Pure decision: which actionable event (if any) a submission outcome warrants. */
export function decideSubmissionEvent(
  disposition: SubmissionDisposition,
  attempts: number,
  orderId: string,
): OrderEventDecision | null {
  if (disposition === "permanent") {
    return {
      eventType: NotificationEventType.OrderPermanentFailure,
      severity: NotificationSeverity.Critical,
      key: permanentFailureKey(orderId),
      title: "Provider permanently rejected an order",
      message: `Order ${orderId} was definitively rejected by the provider (not accepted, not retried) and the wallet debit has been refunded.`,
    };
  }
  if (disposition === "ambiguous") {
    return {
      eventType: NotificationEventType.OrderAmbiguousResult,
      severity: NotificationSeverity.Critical,
      key: ambiguousResultKey(orderId),
      title: "Ambiguous provider outcome — manual review required",
      message: `Order ${orderId} hit an ambiguous provider outcome (provider acceptance could not be ruled out). It was parked for review — not retried, not refunded.`,
    };
  }
  // Transient: actionable only when the bounded retry budget is exhausted.
  if (attempts >= MAX_SUBMISSION_ATTEMPTS) {
    return {
      eventType: NotificationEventType.OrderMaxRetries,
      severity: NotificationSeverity.Critical,
      key: maxRetriesKey(orderId),
      title: "Order exhausted maximum submission retries",
      message: `Order ${orderId} exhausted ${MAX_SUBMISSION_ATTEMPTS} submission attempts and was parked for manual review.`,
    };
  }
  return null; // Ordinary transient retry — not actionable, no notification.
}

/** Pure decision: which actionable event (if any) a status-poll failure warrants. */
export function decidePollFailureEvent(orderId: string, attempts: number): OrderEventDecision | null {
  if (attempts < MAX_SUBMISSION_ATTEMPTS) return null; // transient — retry scheduled
  return {
    eventType: NotificationEventType.OrderPollingFailed,
    severity: NotificationSeverity.Critical,
    key: pollingFailedKey(orderId),
    title: "Provider status polling repeatedly failed",
    message: `Order ${orderId}: provider status polling failed ${attempts} consecutive times. The order was parked for manual review with its current state untouched.`,
  };
}

/** Admin user ids that should receive operational notifications (cached briefly). */
let adminRecipientCache: { ids: string[]; expiresAt: number } | null = null;

/** Test-only seam: clear the cached admin-recipient list between suites. */
export function __resetNotificationRecipientsForTests(): void {
  adminRecipientCache = null;
}
async function adminRecipientIds(): Promise<string[]> {
  const now = Date.now();
  if (adminRecipientCache && adminRecipientCache.expiresAt > now) return adminRecipientCache.ids;
  try {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    const ids = admins.map((a) => String((a as { _id: unknown })._id));
    adminRecipientCache = { ids, expiresAt: now + 60_000 };
    return ids;
  } catch {
    return []; // Never let recipient lookup break order processing.
  }
}

/**
 * Emit an actionable event to all admins. Fire-safe: every failure path is
 * swallowed — this function can never throw and never mutates order state.
 *
 * The persisted `eventKey` is scoped per recipient
 * (`<logicalEventKey>:<adminId>`): the unique index then guarantees
 * "exactly one notification per admin per logical event", so repeated
 * scheduler ticks, duplicate worker runs, and multiple admins each behave
 * correctly without ever duplicating a recipient's feed entry.
 */
async function notifyAdminsOf(params: {
  decision: OrderEventDecision;
  orderId: string | { toString(): string };
  relatedUserId: unknown;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const orderId = String(params.orderId);
    const admins = await adminRecipientIds();
    if (admins.length === 0) return;
    await Promise.all(
      admins.map((adminId) =>
        sendNotification({
          userId: adminId,
          eventType: params.decision.eventType,
          severity: params.decision.severity,
          title: params.decision.title,
          message: params.decision.message,
          orderId,
          relatedUserId: (params.relatedUserId ?? null) as string | null,
          // Logical key only — sendNotification() appends `:<adminId>` exactly
          // once. Pre-scoping here would double-scope and break idempotency.
          eventKey: params.decision.key,
          metadata: params.metadata ?? null,
        }),
      ),
    );
  } catch (error) {
    // Absolute isolation: notification emission must never affect the worker.
    console.error("[worker:notification]", error instanceof Error ? error.message.slice(0, 200) : error);
  }
}

/**
 * Classify a provider submission failure using machine-readable
 * `SmmApiError.kind` / `httpStatus` (never message text).
 * - transient: 429, 5xx, or transport failure proving the provider never
 *   received the request (DNS/refused/unreachable). Safe to retry.
 * - permanent: provider 4xx (non-429) or confirmed business rejection.
 * - ambiguous: timeout, parse failure, or network failure where provider
 *   acceptance cannot be ruled out. MUST NOT retry, MUST NOT refund.
 */
export function classifySubmissionFailure(error: unknown): {
  disposition: SubmissionDisposition;
  reason: string;
} {
  if (error instanceof SmmApiError) {
    const status = error.httpStatus;
    if (status === 429) {
      return { disposition: "transient", reason: "Provider rate-limited the request (HTTP 429)." };
    }
    if (status !== undefined && status >= 500) {
      return { disposition: "transient", reason: `Provider server error (HTTP ${status}); retryable.` };
    }
    if (status !== undefined && status >= 400) {
      return { disposition: "permanent", reason: `Provider rejected the order` };
    }
    // Provider kind without an HTTP status.
    if (error.kind === "config") {
      return { disposition: "permanent", reason: "Provider is not configured (missing SMM_API_KEY)." };
    }
    if (error.kind === "parse") {
      return { disposition: "ambiguous", reason: "Provider returned an unparseable response." };
    }
    // No HTTP status and kind is network/timeout → ambiguous.
    if (error.kind === "network" || error.kind === "timeout") {
      return {
        disposition: "ambiguous",
        reason: `Provider request failed with unknown state (${error.kind}).`,
      };
    }
    return { disposition: "ambiguous", reason: "Provider request failed with unknown state." };
  }
  // Non-SmmApiError — unknown, treat as ambiguous.
  return { disposition: "ambiguous", reason: "Unexpected error; provider state unknown." };
}

/** Matches MongoDB duplicate-key errors (E11000), including wrapped ones. */
function isDuplicateKeyError(error: unknown): boolean {
  const err = error as { code?: number; message?: string } | undefined;
  return err?.code === 11000 || (typeof err?.message === "string" && err.message.includes("E11000"));
}

// Re-export isProviderConfigured so routes can pre-check configuration.
export { isProviderConfigured };

type IOrderDoc = InstanceType<typeof Order>;

/** Terminal statuses that must NEVER be overwritten by the worker. */
const TERMINAL_STATUSES = new Set<OrderStatus>(["completed", "cancelled", "failed"]);

/**
 * Maps the upstream provider's free-form status strings to the local
 * OrderStatus enum. Unknown provider statuses are intentionally NOT mapped
 * to `completed` — the worker leaves the local status unchanged.
 * Exported for unit tests.
 */
export function mapProviderStatus(providerStatus: string): OrderStatus | null {
  const s = providerStatus.toLowerCase();
  switch (s) {
    case "pending":
      return "pending" as OrderStatus;
    case "processing":
    case "in progress":
    case "inprogress":
      return "in_progress" as OrderStatus;
    case "completed":
      return "completed" as OrderStatus;
    case "partial":
      return "partial" as OrderStatus;
    case "cancelled":
    case "canceled":
      return "cancelled" as OrderStatus;
    case "failed":
      return "failed" as OrderStatus;
    default:
      return null; // unknown — do not auto-transition
  }
}

/**
 * Atomically claim an order for this worker invocation.
 * Only claims orders whose `workerClaimUntil` lease has expired (or is unset).
 */
async function claimOrder(orderId: string): Promise<IOrderDoc | null> {
  const now = new Date();
  const claimUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const updated = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [{ workerClaimUntil: { $lte: now } }, { workerClaimUntil: { $exists: false } }],
    },
    { $set: { workerClaimUntil: claimUntil, updatedAt: now } },
    { new: true },
  );
  return updated;
}

/** Release the worker claim on an order (best-effort). */
async function releaseClaim(orderId: string): Promise<void> {
  const now = new Date();
  await Order.updateOne(
    { _id: orderId },
    { $set: { updatedAt: now }, $unset: { workerClaimUntil: "" } },
  );
}

/** Park an order for manual review: never retries, never refunds. */
async function parkForReview(orderId: string, reason: string): Promise<void> {
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        needsReview: true,
        submissionInFlight: false,
        nextRetryAt: null,
        workerClaimUntil: null,
        smmLastError: `NEEDS-REVIEW: ${reason.slice(0, 300)}`,
        smmStatus: "needs-review",
      },
    },
  );
}

/**
 * Atomically transition an order into a refund-bearing terminal state
 * (failed/cancelled) and refund its wallet debit EXACTLY ONCE.
 *
 * Safety:
 *  - Claim: conditional on the current status NOT already being terminal, so
 *    only the FIRST writer wins (admin route, another worker, webhook).
 *  - Idempotency: the refund Transaction carries `refundForOrderId`, enforced
 *    unique by the schema's sparse-unique index. A concurrent duplicate is
 *    tolerated (E11000) as "another writer refunded first" — never re-credited.
 *  - Atomicity: claim + balance credit + ledger row share one MongoDB
 *    transaction (fail-closed in production without a replica set).
 * Returns true only when THIS call both claimed the terminal state and
 * completed the (idempotent) refund path.
 */
async function failAndRefund(
  order: IOrderDoc,
  targetStatus: "failed" | "cancelled",
  metadata: Record<string, unknown>,
  note: string,
): Promise<boolean> {
  const { ok, result } = await runInTransaction(async (session) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: { $nin: [...TERMINAL_STATUSES] } },
      {
        $set: {
          status: targetStatus,
          adminNote: note.slice(0, 300),
          submissionInFlight: false,
          nextRetryAt: null,
          workerClaimUntil: null,
          smmLastError: note.slice(0, 300),
          ...metadata,
        },
      },
      { returnDocument: "after", ...txOpts(session) },
    );
    // Another writer already moved this order to a terminal state — do not
    // refund again; the existing refund logic (admin route) owns that path.
    if (!updated) return null;

    const existingRefund = await Transaction.findOne({
      refundForOrderId: updated._id,
    }).session(session ?? null);
    if (existingRefund) return updated;

    const refund = num(updated.totalCost);
    // Ledger row FIRST (P0): the sparse-unique refundForOrderId index is the
    // exactly-once mutex. Only the first writer creates it; a concurrent
    // refund hits E11000 and returns before moving any credit — no double
    // credit even on the sequential standalone fallback (where the balance
    // $inc and the ledger row are not jointly atomic).
    try {
      await Transaction.create(
        [
          {
            userId: updated.userId,
            type: "credit",
            amount: refund,
            description: `Refund for failed order #${updated._id}`,
            refundForOrderId: updated._id,
            paymentStatus: "success",
          },
        ],
        txOpts(session),
      );
    } catch (error) {
      // Concurrent refund won the race (admin route or another worker
      // attempt): no credit was moved by this writer — swallow the duplicate.
      if (!isDuplicateKeyError(error)) throw error;
      return updated;
    }
    await User.findByIdAndUpdate(
      updated.userId,
      { $inc: { creditBalance: refund } },
      txOpts(session),
    );
    return updated;
  });

  if (ok && result !== null) return true;
  if (!ok) {
    // Transaction refused/failed (e.g. fail-closed): clear the in-flight flag
    // so the next worker run can re-attempt instead of leaving a stuck order.
    await Order.updateOne(
      { _id: order._id, submissionInFlight: true },
      { $set: { submissionInFlight: false } },
    );
  }
  return false;
}

/**
 * Submit an order that has no `smmOrderId` to the provider.
 * AMBIGUOUS-OUTCOME RULE: transient failures are retried with backoff;
 * permanent failures are parked; ambiguous failures are parked for review
 * WITHOUT re-submitting or refunding.
 */
async function submitOrder(order: IOrderDoc, summary: WorkerSummary): Promise<void> {
  const service = await Service.findById(order.serviceId).lean();
  const providerServiceId = service?.providerServiceId;
  if (!providerServiceId) {
    summary.skippedNoProvider += 1;
    summary.errors.push(`order ${order._id}: service has no provider mapping`);
    await parkForReview(String(order._id), "service has no provider mapping");
    await notifyAdminsOf({
      decision: {
        eventType: NotificationEventType.OrderNeedsReview,
        severity: NotificationSeverity.Warning,
        key: needsReviewKey(String(order._id)),
        title: "Order parked for review — no provider mapping",
        message: `Order ${order._id} was parked for manual review: its service has no provider service mapping. Nothing was retried, refunded, or charged beyond the original debit.`,
      },
      orderId: order._id,
      relatedUserId: order.userId,
      metadata: { failReason: "service has no provider mapping" },
    });
    return;
  }

  // Mark submission-in-flight BEFORE the provider call so a crash during the
  // request is recoverable (next worker run sees submissionInFlight=true).
  await Order.updateOne(
    { _id: order._id },
    { $set: { submissionInFlight: true, smmLastError: null, updatedAt: new Date() } },
  );

  let providerOrderId: number | null = null;
  let submissionError: unknown = null;
  try {
    const result = await addOrder({
      service: providerServiceId,
      link: order.link,
      quantity: order.quantity,
    });
    providerOrderId = result.orderId;
  } catch (error) {
    submissionError = error;
  }

  // ---- Success: persist provider id + move to processing ----
  if (providerOrderId !== null && submissionError === null) {
    // Only persist if no duplicate was assigned by a concurrent worker (E11000
    // on the unique sparse smmOrderId index protects us; this clause is the
    // application-level half of the safeguard).
    await Order.updateOne(
      { _id: order._id, smmOrderId: { $exists: false } },
      {
        $set: {
          smmOrderId: providerOrderId,
          status: "processing" as OrderStatus,
          submissionInFlight: false,
          nextRetryAt: null,
          smmLastError: null,
          updatedAt: new Date(),
        },
      },
    );
    summary.submitted += 1;
    return;
  }

  // ---- Failure classification ----
  const { disposition, reason } = classifySubmissionFailure(submissionError);
  const attempts = (order.smmAttempts ?? 0) + 1;
  const truncatedReason = (
    reason + (submissionError instanceof Error ? ` (${submissionError.message.slice(0, 160)})` : "")
  ).slice(0, 300);

  if (disposition === "transient") {
    if (attempts >= MAX_SUBMISSION_ATTEMPTS) {
      summary.needsReview += 1;
      await parkForReview(String(order._id), `exhausted retries after ${attempts} attempts: ${truncatedReason}`);
      const event = decideSubmissionEvent(disposition, attempts, String(order._id));
      if (event) {
        await notifyAdminsOf({
          decision: event,
          orderId: order._id,
          relatedUserId: order.userId,
          metadata: { failReason: truncatedReason, smmAttempt: attempts },
        });
      }
    } else {
      const nextRetryAt = new Date(Date.now() + backoffForAttempt(attempts));
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            smmAttempts: attempts,
            nextRetryAt,
            smmLastError: truncatedReason,
            submissionInFlight: false,
            needsReview: false,
            updatedAt: new Date(),
          },
        },
      );
      summary.scheduledRetry += 1;
    }
    return;
  }

  if (disposition === "permanent") {
    // Definitively NOT accepted by the provider (4xx business rejection /
    // missing configuration): existing business rules refund the user (same
    // behavior as the synchronous route). Atomic + idempotent via
    // failAndRefund; an ambiguous or transient outcome NEVER reaches here.
    const refunded = await failAndRefund(
      order,
      "failed",
      { smmStatus: "failed" },
      `permanent provider failure: ${truncatedReason}`,
    );
    if (refunded) {
      summary.failed += 1;
    } else {
      // Claim lost to a concurrent terminal write, or the transaction was
      // refused — do not retry or refund again; record and move on.
      summary.errors.push(`order ${order._id}: permanent-failure transition not applied`);
    }
    // Actionable regardless of which writer claimed the transition (the
    // eventKey keeps it a single notification even across concurrent runs).
    const event = decideSubmissionEvent(disposition, attempts, String(order._id));
    if (event) {
      await notifyAdminsOf({
        decision: event,
        orderId: order._id,
        relatedUserId: order.userId,
        metadata: { failReason: truncatedReason, smmAttempt: attempts, refunded },
      });
    }
    return;
  }

    // Ambiguous: timeout/parse/network — MUST NOT re-submit, MUST NOT refund.
  summary.needsReview += 1;
  await parkForReview(String(order._id), `ambiguous outcome (not retried/not refunded): ${truncatedReason}`);
  const ambiguousEvent = decideSubmissionEvent(disposition, attempts, String(order._id));
  if (ambiguousEvent) {
    await notifyAdminsOf({
      decision: ambiguousEvent,
      orderId: order._id,
      relatedUserId: order.userId,
      metadata: { failReason: truncatedReason, smmAttempt: attempts },
    });
  }
}

/**
 * Poll the provider for an order that already has an `smmOrderId`.
 * Maps provider status → local status, protecting terminal states.
 */
async function syncProviderStatus(order: IOrderDoc, summary: WorkerSummary): Promise<void> {
  let providerStatus;
  try {
    providerStatus = await getOrderStatus(order.smmOrderId as number);
  } catch (error) {
    // Transient status-poll failure — schedule a retry, do NOT touch status.
    const attempts = (order.smmAttempts ?? 0) + 1;
    if (attempts >= MAX_SUBMISSION_ATTEMPTS) {
      summary.needsReview += 1;
      await parkForReview(
        String(order._id),
        `status poll exhausted: ${(error as Error)?.message.slice(0, 160)}`,
      );
      const event = decidePollFailureEvent(String(order._id), attempts);
      if (event) {
        await notifyAdminsOf({
          decision: event,
          orderId: order._id,
          relatedUserId: order.userId,
          metadata: {
            pollFailureCount: attempts,
            failReason: (error as Error)?.message.slice(0, 300) ?? "status poll failed",
          },
        });
      }
    } else {
      const nextRetryAt = new Date(Date.now() + backoffForAttempt(attempts));
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            smmAttempts: attempts,
            nextRetryAt,
            smmLastError: `status_poll_error: ${(error as Error)?.message.slice(0, 200)}`,
            updatedAt: new Date(),
          },
        },
      );
      summary.scheduledRetry += 1;
    }
    return;
  }

  const localStatus = mapProviderStatus(providerStatus.status ?? "");
  const update: Record<string, unknown> = {
    smmStatus: providerStatus.status ?? null,
    startCount: providerStatus.startCount ?? 0,
    remains: providerStatus.remains ?? 0,
    updatedAt: new Date(),
  };

  // Clear transient error state on a successful sync.
  update.smmLastError = null;
  update.nextRetryAt = null;

  const current = order.status as OrderStatus | undefined;
  const isCurrentlyTerminal = current ? TERMINAL_STATUSES.has(current) : false;

  if (localStatus === null) {
    // Unknown provider status — do NOT auto-transition.
    update.smmLastError = `unknown_provider_status: ${(providerStatus.status ?? "").slice(0, 100)}`;
    await Order.updateOne({ _id: order._id }, { $set: update });
    return;
  }

  if (localStatus === "failed" || localStatus === "cancelled") {
    // Provider EXPLICITLY confirms failure/cancellation: apply the existing
    // refund mechanism exactly once (atomic claim + refundForOrderId ledger).
    // An ambiguous poll outcome never reaches here — only a definitive
    // provider status string does.
    const refunded = await failAndRefund(
      order,
      localStatus,
      { smmStatus: providerStatus.status ?? null, startCount: providerStatus.startCount ?? 0, remains: providerStatus.remains ?? 0 },
      `provider reported ${providerStatus.status}`,
    );
    if (refunded) {
      summary.failed += 1;
    } else {
      // Already terminal (another writer won) or transaction refused: leave
      // untouched — never double-refund, never resurrect.
      update.smmLastError = `refund_transition_skipped: provider=${providerStatus.status}`;
      await Order.updateOne({ _id: order._id }, { $set: update });
    }
    return;
  }

  if (TERMINAL_STATUSES.has(localStatus)) {
    // Provider reports completed/partial. Safe to set (idempotent).
    update.status = localStatus;
  } else {
    // Non-terminal provider status.
    if (isCurrentlyTerminal) {
      // Provider says non-terminal but local is terminal — log conflict,
      // do not regress (protects against stale provider responses).
      update.smmLastError = `status_conflict: provider=${providerStatus.status}, local=${current}`;
      await Order.updateOne({ _id: order._id }, { $set: update });
      return;
    }
    update.status = localStatus;
  }

  await Order.updateOne({ _id: order._id }, { $set: update });
}

/**
 * Process one order: submit or sync, depending on whether it has a
 * provider id. Skips terminal orders. Failure of one order is isolated.
 */
async function processOrder(order: IOrderDoc, summary: WorkerSummary): Promise<void> {
  const status = order.status as OrderStatus | undefined;
  if (status && TERMINAL_STATUSES.has(status)) return;

  // Case A: has provider id → poll status.
  if (order.smmOrderId && order.smmOrderId > 0) {
    await syncProviderStatus(order, summary);
    return;
  }

  // Case B: no provider id → submit.
  await submitOrder(order, summary);
}

/**
 * Process a batch of orders that need worker attention.
 *
 * Cohort 1: unsubmitted/retryable pending orders (no smmOrderId, retry due,
 *           not claimed, not terminal, not needsReview, not in-flight).
 * Cohort 2: orders with a smmOrderId and non-terminal status due for polling.
 *
 * Bounded by `limit` (max WORKER_BATCH_MAX).
 */
export async function processDueOrders(limit = WORKER_BATCH_DEFAULT): Promise<WorkerSummary> {
  const summary = emptySummary();
  const cap = Math.min(Math.max(limit, 1), WORKER_BATCH_MAX);
  const now = new Date();

  // ---- Cohort 1: recover / submit unsubmitted orders ----
  // NOTE: the clientRequestId filter EXCLUDES the manual flow: POST /api/orders
  // (legacy manual fulfilment) stamps `manual-<uuid>` on every order it
  // creates. Automated service orders legitimately carry a client idempotency
  // key (Phase 2C-4), so ONLY the `manual-` prefix is excluded here — the
  // `^manual-` prefix is reserved for the manual route and is never accepted
  // from API clients (validator rejects it, making collisions impossible).
  const unsubmitted = await Order.find({
    status: { $in: ["pending"] },
    smmOrderId: { $exists: false },
    clientRequestId: { $not: /^manual-/ },
    needsReview: { $ne: true },
    submissionInFlight: { $ne: true },
    $and: [
      { $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
      {
        $or: [
          { workerClaimUntil: { $exists: false } },
          { workerClaimUntil: { $lte: now } },
        ],
      },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(cap)
    .lean();

  // ---- Cohort 2: status-sync for orders with a provider id ----
  const syncCandidates = await Order.find({
    smmOrderId: { $gt: 0 },
    clientRequestId: { $not: /^manual-/ },
    status: { $nin: ["completed", "cancelled", "failed"] },
    needsReview: { $ne: true },
    submissionInFlight: { $ne: true },
    $or: [
      { workerClaimUntil: { $exists: false } },
      { workerClaimUntil: { $lte: now } },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(cap)
    .lean();

  const all = [...unsubmitted, ...syncCandidates].slice(0, cap);
  summary.due = all.length;

  for (const order of all) {
    try {
      const claimed = await claimOrder(String(order._id));
      if (!claimed) continue; // another worker holds the lease
      summary.claimed += 1;
      await processOrder(claimed, summary);
      await releaseClaim(String(order._id));
    } catch (error) {
      const msg = (error as Error)?.message.slice(0, 200) ?? String(error);
      summary.errors.push(`order ${order._id}: ${msg}`);
      // Best-effort: clear the claim so the order isn't stuck.
      await releaseClaim(String(order._id));
    }
  }

  return summary;
}
