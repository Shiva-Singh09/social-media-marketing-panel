/**
 * POST /api/services/order — automated service ordering with credit deduction.
 *
 * End-to-end flow (single request):
 *   1. Validate input (zod) + ownership-free public checks.
 *   2. Load the panel Service → resolve PROVIDER cost + markup.
 *      userCost = quantity/1000 × providerCostPer1000 × (1 + markupPercent/100)
 *      e.g. provider charges 100 → user is deducted 130 (default +30%).
 *   3. ATOMIC MongoDB transaction:
 *        - conditionally deduct credits (only if balance ≥ cost),
 *        - create the Order (status=pending) + debit Transaction.
 *   4. Place the order at the SMM provider (`action=add`).
 *        - success → Order becomes `processing` with its smmOrderId stored;
 *        - failure → compensating transaction REFUNDS the credits, marks the
 *          Order `failed` and records a refund Transaction. The user is never
 *          charged for an order the provider did not accept.
 *
 * Idempotency (Phase 2C-4): an optional `clientRequestId` from the client
 * makes retries of the same logical request (double-click, network retry,
 * refresh after timeout) return the original order instead of debiting the
 * wallet again or creating a second order. The server generates an
 * `auto-<uuid>` key when the client does not supply one. The per-user
 * partial-unique (userId, clientRequestId) index is the final concurrency
 * guard: a duplicate-key race is recovered by returning the winner's order.
 *
 * Credits are ADDED by the Razorpay webhook (/api/payment/webhook) after a
 * successful payment capture — see README_SMM_INTEGRATION.md §7.
 */

import { randomUUID } from "node:crypto";

import { Order, Service, Transaction, User } from "@/db";
import { runInTransaction, supportsTransactions, txOpts } from "@/db/transactions";
import { fail, handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { userCostForQuantity, resolveServicePricing } from "@/lib/pricing";
import { addOrder, isProviderConfigured, SmmApiError } from "@/lib/smm-client";
import { classifySubmissionFailure } from "@/lib/order-worker";
import { firstError, serviceOrderSchema } from "@/lib/smm-validators";
import { isAllowedSocialLink } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** True when `error` is a MongoDB duplicate-key violation (E11000). */
function isDuplicateKeyError(error: unknown): boolean {
  const err = error as { code?: number; message?: string } | null;
  return (
    err?.code === 11000 ||
    (typeof err?.message === "string" && err.message.includes("E11000"))
  );
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "order", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = serviceOrderSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { serviceId, link, quantity, clientRequestId } = parsed.data;

    // ---- Load service + its category (for platform-scoped link checks) ----
    const service = await Service.findById(serviceId)
      .populate("categoryId", "platformKey name")
      .lean();
    if (!service) return fail("Service not found", 404);

    const category = service.categoryId as unknown as
      | { platformKey?: string | null; name?: string }
      | undefined;

    if (service.status !== "active") return fail("This service is currently unavailable", 400);
    if (quantity < service.minQuantity || quantity > service.maxQuantity) {
      return fail(
        `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`,
        422,
      );
    }

    const linkCheck = isAllowedSocialLink(link, category?.platformKey ?? undefined);
    if (!linkCheck.ok) return fail(linkCheck.reason ?? "Invalid link", 422);

    // Automated flow requires a mapped provider service id.
    if (!service.providerServiceId) {
      return fail(
        "This service is not enabled for automated ordering yet — please contact support",
        409,
      );
    }
    // ---- Phase 0: idempotent replay (Phase 2C-4) ----
    // A repeated request with the same clientRequestId from the SAME user must
    // never debit again or create a second order: return the original result.
    // The lookup is scoped to the user — one user's key can never match or
    // reuse another user's order — and the partial-unique index is the final
    // guard for concurrent identical requests (recovered below via E11000).
    if (clientRequestId) {
      const prior = await Order.findOne({ userId: user._id, clientRequestId }).lean();
      if (prior) {
        console.info("[services:order] idempotent replay — returning existing order", {
          orderId: String(prior._id),
          clientRequestId,
        });
        return ok(
          {
            orderId: String(prior._id),
            smmOrderId: prior.smmOrderId ?? null,
            status: prior.status,
            chargedCredits: num(prior.totalCost),
            balance: num(user.creditBalance),
            duplicate: true,
          },
          prior.status === "failed"
            ? "This order was already placed and failed — any refund is handled automatically; no new charge was made"
            : "This order was already placed — returning the original result (no double charge)",
          200,
        );
      }
    }

    if (!isProviderConfigured()) {
      return fail("Ordering is temporarily unavailable — provider not configured", 503);
    }

    // ---- Price server-side; NEVER trust a client-supplied amount ----
    const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
    const totalCost = userCostForQuantity(quantity, providerCostPer1000, markupPercent);
    if (totalCost <= 0) return fail("Calculated order cost is invalid", 400);

    if (num(user.creditBalance) < totalCost) {
      return fail(
        `Insufficient balance. This order costs ${totalCost.toFixed(2)} credits — please add funds first.`,
        402,
      );
    }

    // ---- Phase 1: atomically deduct credits + persist the order ----
    // (real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB — see src/db/transactions.ts)
    const holder: { orderId?: string; balance?: number; debitId?: string } = {};
    const { ok: deducted, error: txError } = await runInTransaction(async (session) => {
      // Conditional decrement: only subtract when the balance covers the cost.
      // `updatePipeline: true` is REQUIRED in Mongoose 9 for pipeline updates.
      const updated = await User.findByIdAndUpdate(
        user._id,
        [
          {
            $set: {
              creditBalance: {
                $cond: [
                  { $gte: ["$creditBalance", totalCost] },
                  { $round: [{ $subtract: ["$creditBalance", totalCost] }, 2] },
                  "$creditBalance",
                ],
              },
            },
          },
        ],
        { returnDocument: "after", updatePipeline: true, ...txOpts(session) },
      );
      if (!updated) throw new Error("User not found");

      // If funds were insufficient the $cond left the balance untouched —
      // detect that instead of trusting the client-side pre-check alone
      // (two concurrent orders could otherwise both pass the check).
      const newBalance = num(updated.creditBalance);
      if (Math.abs(newBalance - (num(user.creditBalance) - totalCost)) > 0.001) {
        throw new Error("Insufficient balance");
      }
      // Record the deduction EARLY: the E11000 duplicate-key recovery below
      // uses this to compensate on deployments without transaction rollback.
      holder.balance = newBalance;

      const [order] = await Order.create(
        [
          {
            userId: user._id,
            serviceId: service._id,
            link,
            quantity,
            totalCost,
            status: "pending",
            remains: quantity,
            // Idempotency key (Phase 2C-4): client-supplied, or a fresh
            // server-generated `auto-<uuid>` so every order is addressable.
            clientRequestId: clientRequestId || `auto-${randomUUID()}`,
          },
        ],
        { ...txOpts(session) },
      );

      const [debit] = await Transaction.create(
        [
          {
            userId: user._id,
            type: "debit",
            amount: totalCost,
            description: `Order #${order._id} — ${service.name} (${markupPercent}% margin)`,
            paymentStatus: "success",
          },
        ],
        txOpts(session),
      );

      // Real FK to the wallet debit (Phase 2C-4). The free-text description
      // stays only as a human-readable record — audits query debitTransactionId.
      await Order.updateOne(
        { _id: order._id, debitTransactionId: null },
        { $set: { debitTransactionId: debit._id } },
        txOpts(session),
      );

      holder.orderId = String(order._id);
      holder.balance = newBalance;
      holder.debitId = String(debit._id);
    });

    if (!deducted || !holder.orderId) {
      // ---- Duplicate-key race (Phase 2C-4) ----
      // A concurrent identical request (same user + clientRequestId) created
      // the order first and won the partial-unique index. The unique index is
      // the final concurrency guard — recover by returning the winner's order
      // instead of converting the race into a generic 500.
      if (clientRequestId && isDuplicateKeyError(txError)) {
        if (!(await supportsTransactions())) {
          // Standalone dev fallback has NO rollback: this loser request
          // already wrote its balance deduction (and possibly the debit row)
          // — compensate so only ONE debit ever sticks. On a replica set the
          // aborted transaction already restored everything.
          await runInTransaction(async (session) => {
            if (holder.balance !== undefined) {
              await User.findByIdAndUpdate(
                user._id,
                { $inc: { creditBalance: totalCost } },
                txOpts(session),
              );
            }
            if (holder.debitId) {
              await Transaction.deleteOne(
                { _id: holder.debitId, type: "debit", userId: user._id },
                txOpts(session),
              );
            }
          });
        }
        const winner = await Order.findOne({ userId: user._id, clientRequestId }).lean();
        if (winner) {
          console.warn("[services:order] duplicate-key race — returning the winner's order", {
            clientRequestId,
          });
          return ok(
            {
              orderId: String(winner._id),
              smmOrderId: winner.smmOrderId ?? null,
              status: winner.status,
              chargedCredits: num(winner.totalCost),
              balance: num(user.creditBalance),
              duplicate: true,
            },
            "This order was already placed — returning the original result (no double charge)",
            200,
          );
        }
        // Duplicate key but no matching order (unexpected) — refuse safely.
        return fail("A duplicate request was detected — please check your order history", 409);
      }
      // Distinguish a genuine balance shortfall from unexpected failures.
      const reason = txError instanceof Error ? txError.message : "";
      if (reason === "Insufficient balance" || !holder.orderId) {
        return fail(
          `Insufficient balance: this order costs ${totalCost.toFixed(2)} credits but your balance is ${num(
            user.creditBalance,
          ).toFixed(2)}. Please add funds first.`,
          402,
          { required: totalCost, balance: num(user.creditBalance) },
        );
      }
      console.error("[services:order] deduction failed", { reason: reason.slice(0, 160) });
      return fail("Could not place the order right now. Please try again.", 500);
    }

    // ---- Phase 2: place the order at the SMM provider ----
    try {
      const { orderId: providerOrderId } = await addOrder({
        service: service.providerServiceId,
        link,
        quantity,
      });

      await Order.updateOne(
        { _id: holder.orderId },
        { $set: { status: "processing", smmOrderId: providerOrderId } },
      );

      return ok(
        {
          orderId: holder.orderId,
          smmOrderId: providerOrderId,
          status: "processing",
          chargedCredits: totalCost,
          providerCostPer1000,
          markupPercent,
          balance: holder.balance,
        },
        "Order placed successfully",
        201,
      );
    } catch (error) {
      const { disposition } = classifySubmissionFailure(error);

      // Transient failures: do NOT refund. Leave the order `pending` with
      // nextRetryAt so the order worker retries with backoff.
      if (disposition === "transient") {
        const nextRetryAt = new Date(Date.now() + 60_000);
        await Order.updateOne(
          { _id: holder.orderId },
          {
            $set: {
              status: "pending",
              submissionInFlight: false,
              nextRetryAt,
              smmAttempts: 1,
              smmLastError:
                error instanceof SmmApiError ? error.message.slice(0, 200) : "transient failure",
            },
          },
        );
        console.error("[services:order] provider placement failed (transient); deferred to worker", {
          orderId: holder.orderId,
          kind: error instanceof SmmApiError ? error.kind : "unknown",
        });
        return ok(
          {
            orderId: holder.orderId,
            status: "pending",
            chargedCredits: totalCost,
            balance: holder.balance,
            retry: true,
          },
          "Order is queued and will be submitted automatically",
          202,
        );
      }

      // Ambiguous failures (timeout/parse/network-reset): do NOT refund, do NOT
      // re-submit. The worker marks needsReview for admin inspection.
      if (disposition === "ambiguous") {
        await Order.updateOne(
          { _id: holder.orderId },
          {
            $set: {
              status: "pending",
              submissionInFlight: false,
              needsReview: true,
              smmLastError: (error instanceof Error ? error.message : String(error)).slice(0, 200),
            },
          },
        );
        console.error("[services:order] provider placement ambiguous; parked for review", {
          orderId: holder.orderId,
          kind: error instanceof SmmApiError ? error.kind : "unknown",
        });
        return ok(
          {
            orderId: holder.orderId,
            status: "pending",
            chargedCredits: totalCost,
            balance: holder.balance,
            review: true,
          },
          "Order submitted to provider; status pending confirmation — credits held",
          202,
        );
      }

      // Permanent failures: refund what was deducted (existing behavior).
      const reason =
        error instanceof SmmApiError ? error.message : "Provider rejected the order";
      await runInTransaction(async (session) => {
        await User.findByIdAndUpdate(
          user._id,
          { $inc: { creditBalance: totalCost } },
          txOpts(session),
        );
        await Order.updateOne(
          { _id: holder.orderId },
          { $set: { status: "failed", adminNote: reason.slice(0, 300) } },
          txOpts(session),
        );
        await Transaction.create(
          [
            {
              userId: user._id,
              type: "credit",
              amount: totalCost,
              description: `Refund for failed order #${holder.orderId}`,
              paymentStatus: "success",
            },
          ],
          txOpts(session),
        );
      });

      console.error("[services:order] provider placement failed; refunded", {
        orderId: holder.orderId,
        kind: error instanceof SmmApiError ? error.kind : "unknown",
      });

      return fail(`Order could not be placed: ${reason}. Your credits have been refunded.`, 502, {
        orderId: holder.orderId,
        refunded: totalCost,
      });
    }
  });
}