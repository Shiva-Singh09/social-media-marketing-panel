/**
 * Due-post scheduler.
 *
 * Scheduled posts whose `scheduledAt` has passed are picked up by
 * POST /api/posts/process (cron or admin-triggered) and their optional
 * "boost" order is placed through the SMM provider (`action=add`, with
 * drip-feed runs/interval when configured).
 *
 * Concurrency safety: each post is *claimed* with an atomic
 * `findOneAndUpdate(status: scheduled -> processing)` so two overlapping cron
 * invocations (or multiple app instances) can never place duplicate orders.
 */

import { ScheduledPost, type IScheduledPost } from "@/db/mongodb-schema";
import { addOrder, isProviderConfigured, SmmApiError } from "@/lib/smm-client";

export type ProcessSummary = {
  due: number;
  placed: number;
  completed: number;
  failed: number;
  skipped: number;
};

/** Caps stored error text; messages originate from SmmApiError (key-free). */
function safeErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown scheduling error";
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Places the boost order for one post. The post must currently be in
 * `scheduled` state — the atomic claim guarantees single execution.
 */
async function executePost(post: IScheduledPost): Promise<"placed" | "completed" | "failed"> {
  // Atomic claim: only ONE caller wins the transition scheduled -> processing.
  const claimed = await ScheduledPost.findOneAndUpdate(
    { _id: post._id, status: "scheduled" },
    { $set: { status: "processing", processedAt: new Date() } },
    { returnDocument: "after" },
  );
  // Lost the race (another worker claimed it, or it was cancelled meanwhile).
  if (!claimed) return "completed"; // counted as not-ours; see caller mapping

  try {
    if (!claimed.boost) {
      // Nothing to trigger upstream — the post is done from our side.
      await ScheduledPost.updateOne({ _id: claimed._id }, { $set: { status: "completed" } });
      return "completed";
    }

    if (!isProviderConfigured()) {
      throw new SmmApiError(
        "Social media service is not configured (SMM_API_KEY missing) — boost was not ordered.",
        "config",
      );
    }

    const { orderId } = await addOrder({
      service: claimed.boost.serviceId,
      link: claimed.boost.link ?? "",
      quantity: claimed.boost.quantity,
      runs: claimed.boost.runs ?? undefined,
      interval: claimed.boost.interval ?? undefined,
    });

    await ScheduledPost.updateOne(
      { _id: claimed._id },
      { $set: { smmOrderId: orderId, lastError: null } },
    );
    return "placed";
  } catch (error) {
    // Record a sanitized reason on the post itself so users can see why it
    // failed without exposing any infrastructure detail.
    await ScheduledPost.updateOne(
      { _id: claimed._id },
      { $set: { status: "failed", lastError: safeErrorText(error) } },
    );
    console.error("[scheduler] boost placement failed", {
      postId: String(claimed._id),
      kind: error instanceof SmmApiError ? error.kind : "unknown",
    });
    return "failed";
  }
}

/**
 * Executes one specific post immediately ("Post now"). Used by
 * POST /api/posts/schedule when `executeNow` is set. Still goes through the
 * atomic claim, so it composes safely with cron processing.
 */
export async function executePostNow(
  postId: string,
): Promise<"placed" | "completed" | "failed" | "not-found"> {
  const post = await ScheduledPost.findById(postId).lean<IScheduledPost | null>();
  if (!post) return "not-found";
  const result = await executePost(post);
  // A lost race against another worker is reported as completed-noop.
  return result === "completed" ? "completed" : result;
}

/**
 * Processes up to `limit` due posts. Returns a summary suitable for the cron
 * response body / logs. Never throws for individual post failures — those are
 * recorded on the post documents.
 */
export async function processDuePosts(limit = 25): Promise<ProcessSummary> {
  const now = new Date();
  const due = await ScheduledPost.find({
    status: "scheduled",
    scheduledAt: { $lte: now },
  })
    .sort({ scheduledAt: 1 })
    .limit(Math.max(1, Math.min(limit, 50)))
    .lean<IScheduledPost[]>();

  const summary: ProcessSummary = { due: due.length, placed: 0, completed: 0, failed: 0, skipped: 0 };

  for (const post of due) {
    const result = await executePost(post);
    switch (result) {
      case "placed":
        summary.placed += 1;
        break;
      case "completed":
        summary.completed += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      default:
        summary.skipped += 1;
    }
  }

  return summary;
}