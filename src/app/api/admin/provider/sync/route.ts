/**
 * POST /api/admin/provider/sync — import the provider's service catalogue.
 *
 * Calls the SMM provider (`action=services`) and upserts local
 * Categories + Services so every provider service gets:
 *   - providerServiceId   (numeric id used by action=add)
 *   - providerCostPer1000 (the provider's rate — our cost basis)
 *   - markupPercent       (default 30 → users pay cost × 1.3)
 *   - pricePer1000        (marked-up display price)
 *
 * This is the missing piece that makes /api/services/order work: services
 * created manually before the credit system have no provider mapping and
 * answer 409 until synced here.
 *
 * Auth: admin session only. Rate limited per IP.
 */

import { Category, Service } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { applyMarkup, DEFAULT_MARKUP_PERCENT } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { getServices, isProviderConfigured, SmmApiError } from "@/lib/smm-client";

export const dynamic = "force-dynamic";

/**
 * Hard cap so a misbehaving provider cannot stall the request forever.
 * Sized generously: real providers expose thousands of services and every
 * entry must be importable — anything silently left out would defeat the
 * "one catalogue, one price everywhere" guarantee.
 */
const MAX_SERVICES_PER_SYNC = 10_000;

/** Best-effort mapping of a provider category name to our platformKey slug. */
function guessPlatformKey(categoryName: string): string | null {
  const key = categoryName.toLowerCase();
  const known = ["instagram", "youtube", "tiktok", "facebook", "twitter", "telegram"];
  return known.find((p) => key.includes(p)) ?? null;
}

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const limited = await limitOrFail(req, "general", `admin-${admin._id}`);
    if (limited) return fail(limited, 429);

    if (!isProviderConfigured()) {
      return fail("Set SMM_API_KEY in the environment before syncing services", 503);
    }

    // Use the admin-configured global profit margin (Admin → Settings);
    // falls back to the built-in default when unset/invalid.
    const settings = await getSettings();
    const margin =
      Number.isFinite(Number(settings.defaultMarkupPercent)) && Number(settings.defaultMarkupPercent) >= 0
        ? Number(settings.defaultMarkupPercent)
        : DEFAULT_MARKUP_PERCENT;

    let catalogue;
    try {
      catalogue = await getServices();
    } catch (error) {
      return fail(
        error instanceof SmmApiError ? error.message : "Could not fetch provider services",
        502,
      );
    }

    if (catalogue.length === 0) {
      return fail("Provider returned an empty service list", 502);
    }

    let categoriesCreated = 0;
    let servicesUpserted = 0;
    const skipped: number[] = [];

    // Only the slice we actually import counts as "present upstream" — when
    // the catalogue is truncated we must NOT prune, or valid services beyond
    // the cap would be wrongly deactivated.
    const cappedCatalogue = catalogue.slice(0, MAX_SERVICES_PER_SYNC);
    const truncated = catalogue.length > MAX_SERVICES_PER_SYNC;

    for (const svc of cappedCatalogue) {
      try {
        // --- Category upsert ---
        // Look up by the SAME truncated name we store — provider category
        // names can exceed the 60-char limit and would otherwise never match.
        const categoryName = svc.category.slice(0, 60);
        let category = await Category.findOne({ name: categoryName });
        if (!category) {
          category = await Category.create({
            name: categoryName,
            platformKey: guessPlatformKey(categoryName),
            icon: null,
            status: "active",
            sortOrder: 100,
          });
          categoriesCreated += 1;
        }

        // --- Service upsert (keyed by immutable provider id) ---
        const minQty = Math.max(1, Math.trunc(svc.min));
        const maxQty = Math.max(minQty, Math.trunc(svc.max));
        await Service.updateOne(
          { providerServiceId: svc.service },
          {
            $set: {
              categoryId: category._id,
              name: svc.name.slice(0, 120),
              description: `${svc.type} · refill ${svc.refill ? "supported" : "not supported"}`.slice(0, 500),
              providerServiceId: svc.service,
              providerCostPer1000: svc.rate,
              markupPercent: margin,
              // Stored marked-up too, so legacy views reading pricePer1000 raw
              // still agree with what users are charged (cost × margin).
              pricePer1000: applyMarkup(svc.rate, margin),
              minQuantity: minQty,
              maxQuantity: maxQty,
              status: "active",
            },
          },
          { upsert: true },
        );
        servicesUpserted += 1;
      } catch {
        skipped.push(svc.service);
      }
    }

    // Trust guarantee: deactivate provider-linked services that disappeared
    // from the upstream catalogue, so users can never see/order them at a
    // stale price. Manual services (no providerServiceId) are untouched.
    let prunedCount = 0;
    if (!truncated) {
      const presentIds = cappedCatalogue.map((s) => s.service);
      const pruned = await Service.updateMany(
        { providerServiceId: { $ne: null, $nin: presentIds }, status: "active" },
        { $set: { status: "inactive" } },
      );
      prunedCount = pruned.modifiedCount ?? 0;
    }

    console.info("[provider:sync] completed", {
      adminId: String(admin._id),
      fetched: catalogue.length,
      servicesUpserted,
      categoriesCreated,
      skipped: skipped.length,
      pruned: prunedCount,
    });

    return ok(
      {
        fetched: catalogue.length,
        servicesUpserted,
        categoriesCreated,
        skippedCount: skipped.length,
        prunedCount,
        truncated,
      },
      `Synced ${servicesUpserted} service(s) from the provider`,
      201,
    );
  });
}