/**
 * POST /api/posts/schedule  — schedule a post (optionally with a provider boost)
 * GET  /api/posts/schedule  — list the caller's scheduled posts
 * DELETE /api/posts/schedule?id=… — cancel a post that has not gone live yet
 *
 * All handlers are JWT-authenticated (cookie session or Authorization
 * header), rate limited per user, and validated with zod before any data
 * reaches MongoDB or the upstream SMM provider.
 */

import { ScheduledPost, SocialAccount } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { executePostNow } from "@/lib/scheduler";
import {
  cancelPostSchema,
  firstError,
  schedulePostSchema,
  scheduledPostsQuerySchema,
} from "@/lib/smm-validators";

export const dynamic = "force-dynamic";

/** Shape returned to clients — never includes internal-only fields. */
function toPublicPost(post: Record<string, unknown>, account?: Record<string, unknown> | null) {
  return {
    id: post._id,
    accountId: post.accountId,
    accountHandle: account?.handle ?? null,
    platform: post.platform,
    content: post.content,
    mediaUrls: post.mediaUrls ?? [],
    scheduledAt: post.scheduledAt,
    status: post.status,
    boost: post.boost ?? null,
    smmOrderId: post.smmOrderId ?? null,
    lastError: post.lastError ?? null,
    processedAt: post.processedAt ?? null,
    createdAt: post.createdAt,
  };
}

/** GET /api/posts/schedule?page=&limit=&status= */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "analytics", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const url = new URL(req.url);
    const parsed = scheduledPostsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { page, limit, status } = parsed.data;

    const filter: Record<string, unknown> = { userId: user._id };
    if (status) filter.status = status;

    const [rows, total] = await Promise.all([
      ScheduledPost.find(filter)
        .populate("accountId", "handle platform")
        .sort({ scheduledAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ScheduledPost.countDocuments(filter),
    ]);

    const posts = rows.map((row) => {
      const record = row as unknown as Record<string, unknown>;
      const account = record.accountId as Record<string, unknown> | null;
      // When populated, accountId is the account doc; keep the raw id too.
      return toPublicPost(
        { ...record, accountId: account?._id ?? record.accountId },
        account && "handle" in account ? account : null,
      );
    });

    return ok(
      { posts, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } },
      "Scheduled posts loaded",
    );
  });
}

/**
 * POST /api/posts/schedule
 * Body: { accountId, content, mediaUrls?, scheduledAt, executeNow?, boost? }
 *
 * When `boost` is supplied and `executeNow` is true, the provider order is
 * placed immediately; otherwise it is placed by the scheduler once
 * `scheduledAt` passes (POST /api/posts/process).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "schedule", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = schedulePostSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const input = parsed.data;

    // The account must exist, belong to the caller, and be active.
    const account = await SocialAccount.findOne({
      _id: input.accountId,
      userId: user._id,
    });
    if (!account) return fail("Connected account not found", 404);
    if (account.status !== "active") {
      return fail("This account is paused — resume it before scheduling posts", 400);
    }

    const [post] = await ScheduledPost.create([
      {
        userId: user._id,
        accountId: account._id,
        platform: account.platform,
        content: input.content,
        mediaUrls: input.mediaUrls,
        scheduledAt: input.scheduledAt,
        status: "scheduled",
        boost: input.boost ?? null,
      },
    ]);

    // "Post now": claim + place the boost order in this request.
    if (input.executeNow && input.boost) {
      const result = await executePostNow(String(post._id));
      if (result === "failed") {
        const refreshed = await ScheduledPost.findById(post._id).lean();
        return fail(
          (refreshed as { lastError?: string | null } | null)?.lastError ??
            "Boost order could not be placed",
          502,
          { postId: String(post._id) },
        );
      }
    }

    const fresh = await ScheduledPost.findById(post._id)
      .populate("accountId", "handle platform")
      .lean();
    const record = fresh as unknown as Record<string, unknown> | null;
    const accountDoc = record?.accountId as Record<string, unknown> | null;

    return ok(
      toPublicPost(
        { ...(record ?? {}), accountId: accountDoc?._id ?? input.accountId },
        accountDoc && "handle" in accountDoc ? accountDoc : null,
      ),
      input.executeNow && input.boost ? "Post published — boost order placed" : "Post scheduled",
      201,
    );
  });
}

/**
 * DELETE /api/posts/schedule?id=…
 * Only posts still in `scheduled` state can be cancelled — once a boost order
 * exists at the provider it cannot be revoked through this API.
 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "schedule", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const id = new URL(req.url).searchParams.get("id");
    const parsed = cancelPostSchema.safeParse({ id });
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const cancelled = await ScheduledPost.findOneAndUpdate(
      { _id: parsed.data.id, userId: user._id, status: "scheduled" },
      { $set: { status: "cancelled" } },
      { returnDocument: "after" },
    );

    if (!cancelled) {
      const existing = await ScheduledPost.findOne({ _id: parsed.data.id, userId: user._id });
      if (!existing) return fail("Post not found", 404);
      return fail(
        existing.smmOrderId
          ? "This post already went live and its boost order cannot be cancelled"
          : `Posts in "${existing.status}" state cannot be cancelled`,
        409,
      );
    }

    return ok({ id: cancelled._id, status: cancelled.status }, "Post cancelled");
  });
}