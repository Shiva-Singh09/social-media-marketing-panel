/**
 * Zod schemas for the SMM integration endpoints:
 *   - /api/posts/schedule   (schedule / list / cancel posts)
 *   - /api/analytics/fetch  (query analytics, ingest metric snapshots)
 *   - /api/accounts/manage  (connect / update / disconnect social accounts)
 *
 * Every externally-supplied value passes through one of these schemas before
 * touching MongoDB or the upstream provider. Text fields are additionally
 * sanitized (angle brackets stripped) so stored content can never carry raw
 * HTML/script tags into the UI.
 */

import { z } from "zod";
import {
  firstError,
  isPrivateHost,
  objectIdSchema,
  sanitize,
  sanitizeMessage,
} from "@/lib/validators";

export { firstError };

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

/** Platforms we support connecting. "other" covers anything unlisted. */
export const SOCIAL_PLATFORMS = [
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "twitter",
  "telegram",
  "other",
] as const;

export const platformSchema = z.enum(SOCIAL_PLATFORMS);

/** Public https(s) media/link URL — blocks javascript:, data:, private hosts. */
const publicHttpUrl = z
  .string()
  .trim()
  .max(2048)
  .url("Must be a valid URL")
  .refine((value) => /^https?:\/\//i.test(value), "URL must start with http(s)://")
  .refine((value) => {
    try {
      return !isPrivateHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Private/internal addresses are not allowed");

/** Post text: strips HTML tags but preserves line breaks and hashtags. */
const postContent = z
  .string()
  .trim()
  .min(1, "Post content cannot be empty")
  .max(2200, "Post content cannot exceed 2200 characters")
  .transform(sanitizeMessage);

/** Non-negative integer metric (likes/comments/reach/...). */
const metric = z.coerce.number().int().min(0).max(10_000_000_000);

/* ------------------------------------------------------------------ */
/* POST /api/posts/schedule                                            */
/* ------------------------------------------------------------------ */

const MAX_SCHEDULE_HORIZON_DAYS = 90;

/**
 * A post may optionally carry a "boost" — an order placed through the SMM
 * provider when the post goes live (e.g. buy 1000 views for a scheduled reel).
 * Drip-feed rules mirror the provider API: interval is required whenever runs
 * is used, and both must be omitted together.
 */
export const schedulePostSchema = z
  .object({
    /** Connected account (Mongo _id) this post will be published from. */
    accountId: objectIdSchema("Select a connected account"),
    content: postContent,
    mediaUrls: z.array(publicHttpUrl).max(10, "At most 10 media URLs").optional().default([]),
    /** ISO datetime string; must be in the future and within the horizon. */
    scheduledAt: z.coerce
      .date()
      .refine((d) => d.getTime() > Date.now() + 30_000, "Schedule time must be at least 30 seconds in the future")
      .refine(
        (d) => d.getTime() <= Date.now() + MAX_SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000,
        `Posts can be scheduled at most ${MAX_SCHEDULE_HORIZON_DAYS} days ahead`,
      ),
    /**
     * When true the boost order is placed immediately instead of waiting for
     * the scheduler ("Post now"). The post itself is still recorded so
     * analytics stay attributable.
     */
    executeNow: z.boolean().optional().default(false),
    boost: z
      .object({
        /** Numeric provider service id (from action=services), not our Mongo id. */
        serviceId: z.coerce.number().int().positive("Boost service is required"),
        link: publicHttpUrl.optional(),
        quantity: z.coerce.number().int().positive().max(10_000_000),
        runs: z.coerce.number().int().positive().max(1000).optional(),
        /** Provider requires minutes between 5 and 1440 for drip-feed. */
        interval: z.coerce.number().int().min(5).max(1440).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const boost = value.boost;
    if (!boost) return;
    const hasRuns = boost.runs !== undefined;
    const hasInterval = boost.interval !== undefined;
    if (hasRuns !== hasInterval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Drip-feed requires both 'runs' and 'interval' together",
        path: ["boost", hasRuns ? "interval" : "runs"],
      });
    }
  });

/** GET /api/posts/schedule?page=&limit=&status= */
export const scheduledPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["scheduled", "processing", "completed", "failed", "cancelled"]).optional(),
});

/** DELETE /api/posts/schedule?id=... */
export const cancelPostSchema = z.object({
  id: objectIdSchema("Invalid post id"),
});

/** POST /api/posts/process — cron/admin batch size. */
export const processDueSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

/** POST /api/orders/process — order-worker cron/admin batch size. */
export const processOrdersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

/* ------------------------------------------------------------------ */
/* POST /api/services/order (credit deduction + provider order)        */
/* ------------------------------------------------------------------ */

/**
 * Body for the automated ordering flow: credits are deducted with the
 * service's markup applied (see src/lib/pricing.ts) and an order is placed
 * at the SMM provider in the same request.
 */
export const serviceOrderSchema = z.object({
  /** Internal panel service (Mongo _id) — NOT the numeric provider id. */
  serviceId: objectIdSchema("Select a service"),
  link: publicHttpUrl,
  quantity: z.coerce.number().int().positive("Quantity must be a positive number").max(10_000_000),
  /**
   * Optional client idempotency key (Phase 2C-4). When provided, retries of
   * the SAME request (double-click, network retry, refresh after timeout)
   * return the original order instead of debiting the wallet again.
   * Uniqueness is enforced per user by a partial unique index.
   */
  clientRequestId: z
    .string()
    .trim()
    .min(8, "Client request id must be at least 8 characters")
    .max(64, "Client request id must be at most 64 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Client request id may only contain letters, numbers, dashes and underscores")
    // The `manual-` prefix is reserved for the legacy manual-fulfilment route
    // (POST /api/orders), which the order worker uses to exclude its orders —
    // client keys with that prefix would silently never be auto-submitted.
    .refine((v) => !v.startsWith("manual-"), "This client request id prefix is reserved")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* GET + POST /api/analytics/fetch                                     */
/* ------------------------------------------------------------------ */

export const analyticsQuerySchema = z.object({
  /** Scheduled-post id — includes live provider delivery stats when boosted. */
  postId: objectIdSchema("Invalid post id").optional(),
  /** Connected-account id — scopes history to one account. */
  accountId: objectIdSchema("Invalid account id").optional(),
  /** Lookback window in days for the trend series. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const ANALYTICS_SOURCES = ["manual", "webhook", "provider"] as const;

/**
 * Ingest a metrics snapshot (POST). At least one entity reference is required
 * so snapshots are always attributable to something the caller owns.
 */
export const analyticsIngestSchema = z
  .object({
    accountId: objectIdSchema("Invalid account id").optional(),
    postId: objectIdSchema("Invalid post id").optional(),
    orderId: objectIdSchema("Invalid order id").optional(),
    likes: metric.default(0),
    comments: metric.default(0),
    shares: metric.optional(),
    reach: metric.default(0),
    impressions: metric.optional(),
    followers: metric.optional(),
    source: z.enum(ANALYTICS_SOURCES).default("manual"),
    capturedAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.accountId && !value.postId && !value.orderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one of accountId, postId or orderId",
        path: ["accountId"],
      });
    }
  });

/* ------------------------------------------------------------------ */
/* /api/accounts/manage                                                */
/* ------------------------------------------------------------------ */

/** Handle/@username: visible identifier only — never a password or token. */
const handleSchema = z
  .string()
  .trim()
  .min(2, "Handle must be at least 2 characters")
  .max(80, "Handle is too long")
  .transform(sanitize);

/** Free-form metadata bag (profile url, avatar, follower count at connect…). */
const metaSchema = z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional();

export const accountConnectSchema = z.object({
  platform: platformSchema,
  handle: handleSchema,
  /** Platform-side user/page id when known (e.g. IG numeric id, channel id). */
  externalId: z.string().trim().max(120).optional(),
  /**
   * OAuth access token, IF the integration uses one. Stored AES-256-GCM
   * encrypted (see src/lib/crypto.ts); never returned by any endpoint.
   */
  accessToken: z.string().trim().min(8, "Token looks too short").max(2048).optional(),
  refreshToken: z.string().trim().min(8).max(2048).optional(),
  tokenExpiresAt: z.coerce.date().optional().nullable(),
  meta: metaSchema,
});

export const accountUpdateSchema = z.object({
  id: objectIdSchema("Invalid account id"),
  handle: handleSchema.optional(),
  status: z.enum(["active", "paused"]).optional(),
  accessToken: z.string().trim().min(8).max(2048).optional(),
  refreshToken: z.string().trim().min(8).max(2048).optional(),
  tokenExpiresAt: z.coerce.date().optional().nullable(),
  meta: metaSchema,
});

export const accountIdQuerySchema = z.object({
  id: objectIdSchema("Invalid account id"),
});