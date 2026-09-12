/**
 * SMM Provider API client (ethicalsmm.com API v2 compatible).
 *
 * Every social-media action the panel performs against the upstream provider
 * goes through this module. Design goals:
 *
 *  1. Secrets never leak  – the provider API key is read from env on every
 *     call, is never logged, and is stripped from any error message.
 *  2. Fail loudly         – there is NO hardcoded fallback key; calls throw a
 *     typed `SmmApiError` when configuration is missing so routes can answer
 *     with a clean 503 instead of silently sending unauthenticated requests.
 *  3. Defensive parsing   – the upstream is a third party; every response is
 *     shape-checked before it is trusted.
 *  4. Bounded latency     – every request has an AbortSignal timeout and only
 *     idempotent read actions are retried (never `add`, which would double-
 *     order if the first attempt actually succeeded server-side).
 *
 * Supported upstream actions (see README_SMM_INTEGRATION.md):
 *   services | add | status | refill | balance
 */

/** Upstream request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Max attempts for idempotent read actions (1 initial + retries). */
const MAX_READ_RETRIES = 2;

/**
 * Typed error thrown for any provider-side or configuration failure.
 * Messages are safe to surface to clients: they never contain the API key,
 * auth headers, or raw request bodies.
 */
export class SmmApiError extends Error {
  /** Optional machine-readable kind for callers that want to branch on it. */
  kind: "config" | "network" | "timeout" | "provider" | "parse";

  constructor(message: string, kind: SmmApiError["kind"] = "provider") {
    super(message);
    this.name = "SmmApiError";
    this.kind = kind;
  }
}

/** True when the provider credentials are present in the environment. */
export function isProviderConfigured(): boolean {
  return Boolean(process.env.SMM_API_KEY?.trim());
}

/** Reads + validates provider config. Throws `SmmApiError("config")` when unset. */
function providerConfig(): { apiUrl: string; apiKey: string } {
  const apiKey = process.env.SMM_API_KEY?.trim();
  if (!apiKey) {
    throw new SmmApiError(
      "Social media service is not configured. Set SMM_API_KEY in the environment.",
      "config",
    );
  }
  // The endpoint URL is not a secret; defaulting keeps local setups simple
  // while still allowing self-hosted/white-label providers via .env.
  const apiUrl = process.env.SMM_API_URL?.trim() || "https://ethicalsmm.com/api/v2";
  return { apiUrl, apiKey };
}

type SmmParams = Record<string, string | number | boolean | undefined | null>;

interface SmmRequestOptions {
  /** Extra retry attempts. Only pass > 0 for idempotent reads. */
  retries?: number;
}

/**
 * Core POST to the provider's single-endpoint RPC style API.
 * Body is form-encoded exactly as the provider expects (`key`, `action`, ...).
 */
async function smmRequest<T>(action: string, params: SmmParams = {}, options: SmmRequestOptions = {}): Promise<T> {
  const { apiUrl, apiKey } = providerConfig();

  const body = new URLSearchParams({ key: apiKey, action });
  for (const [name, value] of Object.entries(params)) {
    // Skip empty values so optional params (runs/interval) are simply absent.
    if (value !== undefined && value !== null && String(value).length > 0) {
      body.set(name, String(value));
    }
  }

  const retries = Math.max(0, Math.min(options.retries ?? 0, MAX_READ_RETRIES));
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await res.text();

      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new SmmApiError(
          `Provider returned a non-JSON response (HTTP ${res.status}).`,
          "parse",
        );
      }

      // Provider signals failures either through HTTP status or `{ error }`.
      if (!res.ok) {
        throw new SmmApiError(`Provider request failed (HTTP ${res.status}).`, "provider");
      }
      if (json !== null && typeof json === "object" && "error" in json) {
        const message = (json as { error?: unknown }).error;
        throw new SmmApiError(
          typeof message === "string" && message.trim() ? message.trim() : "Provider rejected the request.",
          "provider",
        );
      }

      return json as T;
    } catch (error) {
      lastError = error;
      // Explicit provider rejections are deterministic — retrying cannot help
      // and for `add` it risks duplicate orders. Only transport-level faults
      // (network blips, timeouts) are retried.
      if (error instanceof SmmApiError && error.kind !== "network" && error.kind !== "timeout") break;
      if (attempt >= retries) break;
      // Linear backoff: 500ms, 1000ms, ...
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw normalizeSmmError(lastError);
}

/** Maps low-level fetch failures onto safe, user-presentable messages. */
function normalizeSmmError(error: unknown): SmmApiError {
  if (error instanceof SmmApiError) return error;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return new SmmApiError("The social media service took too long to respond.", "timeout");
    }
    return new SmmApiError("Could not reach the social media service.", "network");
  }
  return new SmmApiError("Unexpected social media service failure.", "network");
}

/* ------------------------------------------------------------------ */
/* Shared response types (defensively parsed from upstream payloads)   */
/* ------------------------------------------------------------------ */

export type SmmService = {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
};

export type SmmOrderStatus = {
  charge: number;
  startCount: number | null;
  status: string;
  remains: number | null;
  currency: string;
};

/* ------------------------- parsing helpers ------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Math.trunc(n);
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/* ================================================================== */
/* Public API — one function per upstream action                       */
/* ================================================================== */

/**
 * `action=services` — list every service the provider offers.
 * Idempotent read → safe to retry.
 */
export async function getServices(): Promise<SmmService[]> {
  const json = await smmRequest<unknown>("services", {}, { retries: 1 });
  if (!Array.isArray(json)) {
    throw new SmmApiError("Provider returned an unexpected services payload.", "parse");
  }
  return json.flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const id = toInt(row.service);
    if (id === null) return []; // skip malformed rows rather than failing the whole list
    return [
      {
        service: id,
        name: toStringValue(row.name, `Service #${id}`),
        type: toStringValue(row.type, "default"),
        category: toStringValue(row.category, "General"),
        rate: toNumber(row.rate) ?? 0,
        min: toInt(row.min) ?? 1,
        max: toInt(row.max) ?? 1,
        refill: Boolean(row.refill),
        cancel: Boolean(row.cancel),
      },
    ];
  });
}

export type AddOrderInput = {
  /** Numeric provider service id (NOT our internal Mongo ObjectId). */
  service: number;
  link: string;
  quantity: number;
  /**
   * Drip-feed options. When `runs` is provided the order is delivered in
   * `runs` chunks spaced `interval` minutes apart (provider requirement:
   * interval must be set whenever runs is used).
   */
  runs?: number;
  interval?: number;
};

/**
 * `action=add` — place an order (optionally drip-fed).
 * NEVER retried automatically: a network blip after the provider accepted
 * the order must not cause a second chargeable order.
 */
export async function addOrder(input: AddOrderInput): Promise<{ orderId: number }> {
  const json = await smmRequest<unknown>("add", {
    service: input.service,
    link: input.link,
    quantity: input.quantity,
    runs: input.runs,
    interval: input.interval,
  });

  const record = asRecord(json);
  const orderId = record ? toInt(record.order) : null;
  if (orderId === null || orderId <= 0) {
    throw new SmmApiError("Provider did not return a valid order id.", "parse");
  }
  return { orderId };
}

/**
 * `action=status` — fetch the live status of a single provider order.
 * Idempotent read → safe to retry.
 */
export async function getOrderStatus(orderId: number): Promise<SmmOrderStatus> {
  const json = await smmRequest<unknown>("status", { order: orderId }, { retries: 1 });
  const record = asRecord(json);
  if (!record) {
    throw new SmmApiError("Provider returned an unexpected status payload.", "parse");
  }
  return {
    charge: toNumber(record.charge) ?? 0,
    startCount: toInt(record.start_count),
    status: toStringValue(record.status, "Unknown"),
    remains: toInt(record.remains),
    currency: toStringValue(record.currency, "USD"),
  };
}

/**
 * `action=status&orders=1,2,3` — batch status lookup.
 * The provider answers with an object keyed by order id; missing keys are
 * omitted from the result rather than invented.
 */
export async function getMultiOrderStatus(orderIds: number[]): Promise<Record<string, SmmOrderStatus>> {
  if (orderIds.length === 0) return {};
  const unique = Array.from(new Set(orderIds)).slice(0, 100); // hard cap per call
  const json = await smmRequest<unknown>("status", { orders: unique.join(",") }, { retries: 1 });

  const record = asRecord(json);
  if (!record) {
    throw new SmmApiError("Provider returned an unexpected batch status payload.", "parse");
  }

  const result: Record<string, SmmOrderStatus> = {};
  for (const [id, raw] of Object.entries(record)) {
    const row = asRecord(raw);
    if (!row) continue;
    result[id] = {
      charge: toNumber(row.charge) ?? 0,
      startCount: toInt(row.start_count),
      status: toStringValue(row.status, "Unknown"),
      remains: toInt(row.remains),
      currency: toStringValue(row.currency, "USD"),
    };
  }
  return result;
}

/**
 * `action=refill` — ask the provider to top an order back up.
 */
export async function requestRefill(orderId: number): Promise<{ refillId: number }> {
  const json = await smmRequest<unknown>("refill", { order: orderId });
  const record = asRecord(json);
  const refillId = record ? toInt(record.refill) : null;
  if (refillId === null) {
    throw new SmmApiError("Provider did not return a valid refill id.", "parse");
  }
  return { refillId };
}

/**
 * `action=balance` — remaining provider credit. Useful for admin dashboards
 * and pre-flight checks before accepting customer orders.
 */
export async function getBalance(): Promise<{ balance: number; currency: string }> {
  const json = await smmRequest<unknown>("balance", {}, { retries: 1 });
  const record = asRecord(json);
  if (!record) {
    throw new SmmApiError("Provider returned an unexpected balance payload.", "parse");
  }
  return {
    balance: toNumber(record.balance) ?? 0,
    currency: toStringValue(record.currency, "USD"),
  };
}