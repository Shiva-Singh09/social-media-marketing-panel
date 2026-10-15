/**
 * In-process order-worker scheduler (Phase 2C-3).
 *
 * Reliably executes the Phase 2C-2 worker without external infrastructure:
 * a single Node `setInterval` tick invokes `processDueOrders()` — the SAME
 * execution core the authenticated `/api/orders/process` endpoint wraps.
 * This is not a second execution path: claiming, backoff state, ambiguous-
 * outcome parking and refund idempotency all live inside the worker itself,
 * so overlapping invocations (in-process or cross-instance) are already safe.
 *
 * Safety properties:
 *  - Bounded batch (worker defaults: 25, max 50) — one tick never monopolizes.
 *  - Overlap guard: a busy-flag skips a tick if the previous one is still
 *    running; the atomic `workerClaimUntil` lease protects cross-process runs
 *    (multiple server instances are safe).
 *  - Persistent state: retry/backoff/claims live in MongoDB, so the scheduler
 *    survives process restarts and deployments with zero recovery logic.
 *  - Timer is unref'd so it never keeps a stopping process alive.
 *
 * Configuration (both optional):
 *  - ORDER_WORKER_ENABLED    default "true" ("false"/"0"/"off" disables)
 *  - ORDER_WORKER_INTERVAL_MS default 60000 (min 15000)
 *
 * On ephemeral/serverless platforms (e.g. Vercel) the interval does not
 * persist between invocations — set ORDER_WORKER_ENABLED=false there and use
 * an external scheduler against POST /api/orders/process with x-cron-secret
 * (see the route's header comment).
 */

import { processDueOrders } from "@/lib/order-worker";

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;

function isEnabled(): boolean {
  const raw = (process.env.ORDER_WORKER_ENABLED ?? "").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off");
}

function intervalMs(): number {
  const raw = Number.parseInt(process.env.ORDER_WORKER_INTERVAL_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
}

let started = false;

export function startOrderWorkerScheduler(): void {
  if (started) return; // instrumentation may run more than once per process
  started = true;

  if (!isEnabled()) {
    console.info("[order-worker] in-process scheduler disabled via ORDER_WORKER_ENABLED");
    return;
  }

  const ms = intervalMs();
  let running = false;

  const tick = async () => {
    if (running) return; // previous tick still in flight — skip, don't pile up
    running = true;
    try {
      const summary = await processDueOrders();
      if (summary.due > 0) {
        console.info("[order-worker] scheduler tick", summary);
      }
    } catch (error) {
      // A failed tick must never kill the interval — log and continue.
      console.error("[order-worker] scheduler tick failed —", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), ms);
  timer.unref?.(); // never keep a stopping process alive on our account

  console.info(`[order-worker] in-process scheduler started (interval ${ms}ms)`);
}