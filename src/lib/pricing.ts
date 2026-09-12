/**
 * Credit-system pricing.
 *
 * The panel buys engagement from the SMM provider at `providerCostPer1000`
 * and charges users a configurable markup (default +30%) on top:
 *
 *     userCost = quantity / 1000 × providerCostPer1000 × (1 + markupPercent/100)
 *
 * Example: provider charges 100 credits → user is deducted 130 credits.
 *
 * All money math stays in 2-decimal fixed point (round-half-away-from-zero
 * via Math.round on paise-scale values) to avoid float drift; the SAME
 * function must be used by every code path that prices an order so the
 * displayed price, the deducted amount and the stored totalCost can never
 * disagree.
 */

/** Default margin applied on top of provider cost when a service has no override. */
export const DEFAULT_MARKUP_PERCENT = 30;

/** Hard cap so a misconfigured service can never produce absurd multipliers. */
export const MAX_MARKUP_PERCENT = 500;

/** Rounds to 2 decimals (cents/credits precision). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Applies the markup multiplier to a per-1000 provider cost.
 * applyMarkup(100, 30) → 130.
 */
export function applyMarkup(
  providerCostPer1000: number,
  markupPercent: number = DEFAULT_MARKUP_PERCENT,
): number {
  const pct = Number.isFinite(markupPercent) ? markupPercent : DEFAULT_MARKUP_PERCENT;
  const clamped = Math.min(Math.max(pct, 0), MAX_MARKUP_PERCENT);
  return round2(providerCostPer1000 * (1 + clamped / 100));
}

/**
 * Full user cost for an order of `quantity` units.
 * This is THE single source of truth for what gets deducted from a balance.
 */
export function userCostForQuantity(
  quantity: number,
  providerCostPer1000: number,
  markupPercent: number = DEFAULT_MARKUP_PERCENT,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return round2((quantity / 1000) * applyMarkup(providerCostPer1000, markupPercent));
}

/**
 * THE price a user pays per 1000 units for a service.
 *
 * This wraps resolveServicePricing + applyMarkup into one call so that every
 * price display (public catalogue, new-order preview, order detail, admin
 * "user pays" column) shows EXACTLY what the order routes deduct. Using any
 * other value anywhere is what caused the same service to appear as ₹10 in
 * one place and ₹13 in another.
 */
export function userRatePer1000(service: {
  pricePer1000: number | string;
  providerCostPer1000?: number | string | null;
  markupPercent?: number | null;
}): number {
  const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
  return applyMarkup(providerCostPer1000, markupPercent);
}

/**
 * Resolves the effective pricing inputs for a service document, applying the
 * documented fallbacks:
 *   - providerCostPer1000 missing → fall back to the admin-set pricePer1000
 *   - markupPercent missing       → DEFAULT_MARKUP_PERCENT
 */
export function resolveServicePricing(service: {
  pricePer1000: number | string;
  providerCostPer1000?: number | string | null;
  markupPercent?: number | null;
}): { providerCostPer1000: number; markupPercent: number } {
  const fallbackCost =
    typeof service.pricePer1000 === "number"
      ? service.pricePer1000
      : Number.parseFloat(String(service.pricePer1000 ?? 0)) || 0;
  const rawProviderCost =
    typeof service.providerCostPer1000 === "number"
      ? service.providerCostPer1000
      : Number.parseFloat(String(service.providerCostPer1000 ?? ""));

  return {
    providerCostPer1000: Number.isFinite(rawProviderCost) && rawProviderCost > 0 ? rawProviderCost : fallbackCost,
    markupPercent:
      typeof service.markupPercent === "number" && Number.isFinite(service.markupPercent)
        ? service.markupPercent
        : DEFAULT_MARKUP_PERCENT,
  };
}