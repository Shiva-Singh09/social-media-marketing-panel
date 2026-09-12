import { z } from "zod";

/** Strips angle brackets / control chars to keep stored text XSS-safe. */
export function sanitize(input: string): string {
  return input.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60).transform(sanitize),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, "Invalid reset token"),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

/** Hostnames that must never be accepted for user-supplied "public" URLs (SSRF guard). */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(hostname));
}

/** Strict https-only URL used for avatar/logo fields — no javascript:, no private hosts. */
const httpsUrl = z
  .string()
  .trim()
  .url("Must be a valid https:// URL")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid URL" });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only https:// URLs are allowed" });
    }
    if (isPrivateHost(url.hostname)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Private/internal hosts are not allowed" });
    }
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(60).transform(sanitize),
  avatar: httpsUrl.optional().or(z.literal("")),
});

/**
 * Social platform domains allowed per category, keyed by the category's
 * immutable `platformKey` slug (NOT its editable display `name`). Keying by
 * name would silently disable link validation the moment an admin renames a
 * category (e.g. "Twitter/X" -> "X (Twitter)").
 */
export const PLATFORM_DOMAINS: Record<string, string[]> = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com"],
  twitter: ["twitter.com", "x.com"],
  telegram: ["t.me", "telegram.me", "telegram.org"],
};

const PLATFORM_KEY_PATTERN = /^[a-z0-9_-]{2,40}$/;

export function isAllowedSocialLink(
  link: string,
  platformKey?: string | null,
): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, reason: "Enter a valid link" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Link must start with http(s)://" };
  }
  const hostname = url.hostname.toLowerCase();
  if (isPrivateHost(hostname)) {
    return { ok: false, reason: "Private/internal addresses are not allowed" };
  }
  const allowed = platformKey ? PLATFORM_DOMAINS[platformKey] : undefined;
  if (allowed && !allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return { ok: false, reason: `Link must be a ${allowed[0]}-style URL` };
  }
  return { ok: true };
}

const socialUrl = z
  .string()
  .trim()
  .url("Enter a valid link (https://...)")
  .refine((value) => /^https?:\/\//i.test(value), "Link must start with http(s)://")
  .refine((value) => {
    try {
      return !isPrivateHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Private/internal addresses are not allowed");

/**
 * MongoDB ObjectId (24 hex chars) — every entity id since the Mongo migration.
 * Replaces the old integer-serial validations that coerced ids with
 * `z.coerce.number()` and produced "expected number, received NaN" errors.
 */
export const objectIdSchema = (message: string) =>
  z.string().trim().regex(/^[0-9a-fA-F]{24}$/, message);

export const createOrderSchema = z.object({
  serviceId: objectIdSchema("Select a service"),
  link: socialUrl,
  quantity: z.coerce.number().int().positive("Quantity must be a positive number"),
});

export const createPaymentSchema = z.object({
  amount: z.coerce.number().positive("Enter a valid amount"),
});

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(3),
  razorpay_payment_id: z.string().min(3),
  razorpay_signature: z.string().optional().default(""),
  demo: z.boolean().optional().default(false),
});

/** Strips angle brackets (blocks raw HTML/script tags) but preserves line breaks. */
export function sanitizeMessage(input: string): string {
  return input.replace(/[<>]/g, "").trim();
}

export const createTicketSchema = z.object({
  subject: z.string().trim().min(4, "Subject is too short").max(120).transform(sanitize),
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters")
    .max(2000)
    .transform(sanitizeMessage),
});

export const replySchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(2000).transform(sanitizeMessage),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(60).transform(sanitize),
  // Optional stable slug used to key link-domain validation (see
  // PLATFORM_DOMAINS above). Left blank/null = no link restriction for that
  // category, which is the safe default for custom/unlisted categories.
  platformKey: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PLATFORM_KEY_PATTERN, "Use lowercase letters, numbers, - or _ only")
    .optional()
    .or(z.literal("")),
  icon: z.string().trim().max(40).optional().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const serviceSchema = z.object({
  categoryId: objectIdSchema("Category is required"),
  name: z.string().trim().min(3).max(120).transform(sanitize),
  description: z.string().trim().max(500).optional().default(""),
  pricePer1000: z.coerce.number().positive("Price must be greater than 0"),
  // --- Credit-system pricing (see src/lib/pricing.ts) ---
  /** Numeric id of this service at the SMM provider; required for the
   *  automated /api/services/order flow, optional for manual fulfilment. */
  providerServiceId: z.coerce.number().int().positive().optional().nullable(),
  /** What the PROVIDER charges per 1000 units; falls back to pricePer1000. */
  providerCostPer1000: z.coerce.number().positive().optional().nullable(),
  /** Margin over provider cost in percent (default 30 → cost × 1.3). */
  markupPercent: z.coerce.number().min(0).max(500).optional(),
  minQuantity: z.coerce.number().int().positive(),
  maxQuantity: z.coerce.number().int().positive(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "in_progress",
  "completed",
  "partial",
  "cancelled",
  "failed",
] as const;

export const TICKET_STATUSES = ["open", "replied", "closed"] as const;
export const TRANSACTION_TYPES = ["credit", "debit"] as const;

/** Narrows an arbitrary query-string value to a known literal union, or undefined. */
export function asEnumValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export const updateOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  startCount: z.coerce.number().int().min(0).optional().nullable(),
  remains: z.coerce.number().int().min(0).optional().nullable(),
  adminNote: z.string().trim().max(500).optional().nullable(),
});

/** Admin balance adjustments are capped to prevent fat-finger or malicious unbounded transfers. */
export const MAX_BALANCE_ADJUSTMENT = 100000;

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  role: z.enum(["user", "admin"]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  balanceAdjustment: z.coerce
    .number()
    .min(-MAX_BALANCE_ADJUSTMENT, `Adjustment cannot go below -₹${MAX_BALANCE_ADJUSTMENT}`)
    .max(MAX_BALANCE_ADJUSTMENT, `Adjustment cannot exceed ₹${MAX_BALANCE_ADJUSTMENT}`)
    .optional(),
  adjustmentNote: z.string().trim().max(160).optional(),
});

export const settingsSchema = z.object({
  siteName: z.string().trim().min(2).max(60),
  siteLogo: httpsUrl.optional().nullable().or(z.literal("")),
  minCreditAmount: z.coerce.number().min(1),
  /** Global profit margin (%) over provider cost. Capped like MAX_MARKUP_PERCENT. */
  defaultMarkupPercent: z.coerce.number().min(0).max(500).optional(),
  announcementText: z.string().trim().max(300).optional().default(""),
  supportEmail: z.string().trim().email().optional().or(z.literal("")),
  maintenanceMode: z.boolean().default(false),
});

/** Turns a ZodError into a single readable message. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
