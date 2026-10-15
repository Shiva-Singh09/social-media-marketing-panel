import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/auth";

/**
 * Standard API response envelope: { success, data, message }
 */
export type ApiEnvelope<T = unknown> = {
  success: boolean;
  data: T | null;
  message: string;
};

export function ok<T>(data: T, message = "OK", status = 200) {
  return Response.json({ success: true, data, message } satisfies ApiEnvelope<T>, {
    status,
  });
}

export function fail(message = "Something went wrong", status = 400, data: unknown = null) {
  return Response.json({ success: false, data, message } satisfies ApiEnvelope, { status });
}

/**
 * Message returned to production clients for ANY unexpected/internal error.
 * Raw Error.message can carry Mongoose internals, connection strings,
 * upstream provider bodies, env-var names and configuration hints — none of
 * which may reach a production client. The full error object is still logged
 * server-side (see handle) so operators never lose debugging information.
 */
const INTERNAL_ERROR_MESSAGE = "Internal server error";

/**
 * Wrap a handler with a try/catch so every controller returns the envelope.
 * A per-request correlation id is stamped on every response (`x-request-id`
 * header, and inside the body of error responses) so a user-reported issue
 * can be matched back to the exact server log line.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  try {
    const res = await fn();
    res.headers.set("x-request-id", requestId);
    return res;
  } catch (error) {
    if (error instanceof HttpError) {
      const res = fail(error.message, error.status, { requestId });
      res.headers.set("x-request-id", requestId);
      return res;
    }
    // Unexpected/internal failure. The detailed message and full error
    // (including stack) go to SERVER logs only; the client response is
    // generic in production. Non-production keeps the detailed message in
    // the body so local debugging stays useful.
    const message = error instanceof Error ? error.message : INTERNAL_ERROR_MESSAGE;
    console.error(`[api-error] [${requestId}]`, message, error);
    const clientMessage =
      process.env.NODE_ENV === "production" ? INTERNAL_ERROR_MESSAGE : message;
    const res = fail(clientMessage, 500, { requestId });
    res.headers.set("x-request-id", requestId);
    return res;
  }
}

/**
 * Coerces any stored money value into a finite number.
 *
 * Monetary fields went through a Postgres→MongoDB migration: legacy rows keep
 * BSON `Decimal128`s, which `.lean()` reads return verbatim and which JSON-
 * serialize as {"$numberDecimal":"20.00"}. Plain `Number(...)` on such an
 * object yields NaN — which is exactly how service rates rendered as ₹0.00 in
 * the UI while the server still charged the real amount. This helper accepts
 * numbers, numeric strings, Decimal128 instances and their JSON shape, and
 * ALWAYS returns a finite number (0 for anything unparseable).
 */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let raw: string | number;
  if (typeof value === "object") {
    const shape = value as { $numberDecimal?: unknown };
    raw =
      typeof shape.$numberDecimal === "string" || typeof shape.$numberDecimal === "number"
        ? shape.$numberDecimal
        : String(value); // Decimal128.prototype.toString() → "20.00"
  } else {
    raw = value as string | number;
  }

  const parsed = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value: string | number | null | undefined): string {
  return num(value).toFixed(2);
}

export function parsePagination(url: URL, defaultLimit = 10) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

/** Maximum characters accepted for free-text `search` query parameters. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * Escapes regex metacharacters so the string can only ever match ITSELF
 * when used as a MongoDB `$regex` pattern. This closes two risks in the
 * search endpoints:
 *  - regex injection: unescaped input like `a|b` or `.*` silently changes
 *    match semantics (and unanchored `.*`-style patterns force scans);
 *  - server-side ReDoS: MongoDB evaluates `$regex` with a backtracking
 *    engine during collection scans, so crafted nested quantifiers such as
 *    `(a+)+$` can pin database CPU. A fully-escaped literal cannot backtrack.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes a raw free-text `search` query parameter into a SAFE literal
 * substring for `$regex` use: trimmed, length-bounded and regex-escaped.
 * The search endpoints intend LITERAL case-insensitive substring matching —
 * this preserves that behavior exactly (escaping is a no-op for plain text)
 * while making metacharacter input harmless. Returns null when there is
 * nothing to search for, so callers keep their existing `if (search)` shape.
 */
export function literalSearchTerm(
  raw: string | null | undefined,
  maxLength = MAX_SEARCH_LENGTH,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  return escapeRegExp(trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed);
}
