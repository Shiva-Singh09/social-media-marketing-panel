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
    const message = error instanceof Error ? error.message : "Internal server error";
     
    console.error(`[api-error] [${requestId}]`, message, error);
    const res = fail(message, 500, { requestId });
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
