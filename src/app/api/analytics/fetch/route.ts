/**
 * GET  /api/analytics/fetch?days=30&accountId=…&postId=…
 *   Aggregates stored metric snapshots into a summary + daily trend series,
 *   optionally enriched with LIVE delivery stats from the SMM provider when a
 *   boosted post is queried.
 *
 * POST /api/analytics/fetch
 *   Ingests a metrics snapshot (likes/comments/reach/…) for an account, post
 *   or panel order — used by manual entry or platform webhooks. Every
 *   referenced entity is ownership-checked before insertion.
 *
 * Both handlers are JWT-authenticated and rate limited per user.
 */

import mongoose from "mongoose";
import { AnalyticsSnapshot, Order, ScheduledPost, SocialAccount } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { getOrderStatus, SmmApiError } from "@/lib/smm-client";
import { analyticsIngestSchema, analyticsQuerySchema, firstError } from "@/lib/smm-validators";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /api/analytics/fetch */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "analytics", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const url = new URL(req.url);
    const parsed = analyticsQuerySchema.safeParse({
      postId: url.searchParams.get("postId") ?? undefined,
      accountId: url.searchParams.get("accountId") ?? undefined,
      days: url.searchParams.get("days") ?? undefined,
    });
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { postId, accountId, days } = parsed.data;

    const since = new Date(Date.now() - days * DAY_MS);
    const ownerId = new mongoose.Types.ObjectId(String(user._id));

    // ---- Optional live provider enrichment for a specific boosted post ----
    let livePost: Record<string, unknown> | null = null;
    if (postId) {
      const post = await ScheduledPost.findOne({ _id: postId, userId: user._id }).lean();
      if (!post) return fail("Scheduled post not found", 404);

      livePost = {
        id: post._id,
        platform: post.platform,
        content: post.content,
        status: post.status,
        scheduledAt: post.scheduledAt,
        boost: post.boost ?? null,
        smmOrderId: post.smmOrderId ?? null,
        lastError: post.lastError ?? null,
        live: null as unknown,
      };

      if (post.smmOrderId) {
        try {
          const status = await getOrderStatus(post.smmOrderId);
          const quantity = post.boost?.quantity ?? null;
          const remains = status.remains;
          (livePost as Record<string, unknown>).live = {
            providerStatus: status.status,
            startCount: status.startCount,
            remains,
            quantity,
            // Delivered so far = ordered minus what the provider still owes.
            delivered:
              quantity !== null && remains !== null ? Math.max(0, quantity - remains) : null,
            charge: status.charge,
            currency: status.currency,
          };
        } catch (error) {
          // Provider hiccup must not break the whole analytics response —
          // surface a flag instead (message is already key-free).
          (livePost as Record<string, unknown>).live = {
            error:
              error instanceof SmmApiError
                ? error.message
                : "Live provider status is temporarily unavailable",
          };
        }
      }
    }

    // ---- Snapshot aggregation over the lookback window ----
    const match: Record<string, unknown> = { userId: ownerId, capturedAt: { $gte: since } };
    if (accountId) match.accountId = new mongoose.Types.ObjectId(accountId);
    if (postId) match.postId = new mongoose.Types.ObjectId(postId);

    const [totals] = await AnalyticsSnapshot.aggregate<{
      likes: number;
      comments: number;
      reach: number;
      impressions: number;
      shares: number;
      snapshots: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          likes: { $sum: "$likes" },
          comments: { $sum: "$comments" },
          reach: { $sum: "$reach" },
          impressions: { $sum: { $ifNull: ["$impressions", 0] } },
          shares: { $sum: { $ifNull: ["$shares", 0] } },
          snapshots: { $sum: 1 },
        },
      },
    ]);

    const series = await AnalyticsSnapshot.aggregate<{
      _id: string;
      likes: number;
      comments: number;
      reach: number;
      impressions: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$capturedAt" } },
          likes: { $sum: "$likes" },
          comments: { $sum: "$comments" },
          reach: { $sum: "$reach" },
          impressions: { $sum: { $ifNull: ["$impressions", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Latest snapshot per connected account (for the per-account cards).
    const perAccount = await AnalyticsSnapshot.aggregate<{
      _id: mongoose.Types.ObjectId | null;
      likes: number;
      comments: number;
      reach: number;
      followers: number | null;
      capturedAt: Date;
    }>([
      { $match: { userId: ownerId, capturedAt: { $gte: since }, accountId: { $ne: null } } },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: "$accountId",
          likes: { $first: "$likes" },
          comments: { $first: "$comments" },
          reach: { $first: "$reach" },
          followers: { $first: "$followers" },
          capturedAt: { $first: "$capturedAt" },
        },
      },
    ]);

    // Attach handles/platforms without N+1 queries.
    const accounts = await SocialAccount.find({ userId: user._id })
      .select("handle platform")
      .lean();
    const accountMap = new Map(accounts.map((a) => [String(a._id), a]));

    return ok(
      {
        window: { days, since, until: new Date() },
        summary: {
          likes: totals?.likes ?? 0,
          comments: totals?.comments ?? 0,
          reach: totals?.reach ?? 0,
          impressions: totals?.impressions ?? 0,
          shares: totals?.shares ?? 0,
          snapshots: totals?.snapshots ?? 0,
        },
        series: series.map((row) => ({
          date: row._id,
          likes: row.likes,
          comments: row.comments,
          reach: row.reach,
          impressions: row.impressions,
        })),
        accounts: perAccount.map((row) => {
          const acct = row._id ? accountMap.get(String(row._id)) : undefined;
          return {
            accountId: row._id,
            handle: acct?.handle ?? "(removed account)",
            platform: acct?.platform ?? "other",
            latest: {
              likes: row.likes,
              comments: row.comments,
              reach: row.reach,
              followers: row.followers,
              capturedAt: row.capturedAt,
            },
          };
        }),
        post: livePost,
      },
      "Analytics loaded",
    );
  });
}

/**
 * POST /api/analytics/fetch — ingest one metrics snapshot.
 * Body: { accountId?|postId?|orderId?, likes, comments, reach, … }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "analytics", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = analyticsIngestSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const input = parsed.data;

    // Ownership checks — a snapshot may only reference entities the caller owns.
    if (input.accountId) {
      const exists = await SocialAccount.exists({ _id: input.accountId, userId: user._id });
      if (!exists) return fail("Connected account not found", 404);
    }
    if (input.postId) {
      const exists = await ScheduledPost.exists({ _id: input.postId, userId: user._id });
      if (!exists) return fail("Scheduled post not found", 404);
    }
    if (input.orderId) {
      const exists = await Order.exists({ _id: input.orderId, userId: user._id });
      if (!exists) return fail("Order not found", 404);
    }

    const [snapshot] = await AnalyticsSnapshot.create([
      {
        userId: user._id,
        accountId: input.accountId ?? null,
        postId: input.postId ?? null,
        orderId: input.orderId ?? null,
        likes: input.likes,
        comments: input.comments,
        shares: input.shares ?? null,
        reach: input.reach,
        impressions: input.impressions ?? null,
        followers: input.followers ?? null,
        source: input.source,
        capturedAt: input.capturedAt ?? new Date(),
      },
    ]);

    return ok(
      {
        id: snapshot._id,
        capturedAt: snapshot.capturedAt,
        source: snapshot.source,
      },
      "Analytics snapshot recorded",
      201,
    );
  });
}