import { SiteSettings, type ISiteSettings } from "@/db/mongodb-schema";
import { DEFAULT_MARKUP_PERCENT } from "@/lib/pricing";

/**
 * Settings are read on almost every authenticated request (navbar balance,
 * announcement banner, minimum top-up amount, maintenance-mode gate). A
 * short in-memory TTL cache avoids hammering MongoDB for effectively static
 * data while still picking up admin edits within a few seconds.
 *
 * Note: this cache is per server process. In a horizontally-scaled
 * deployment each instance has its own cache and its own cold-start, so a
 * setting change can take up to CACHE_TTL_MS to propagate to every instance.
 * For strict multi-instance consistency, swap this for a shared cache
 * (Redis/Upstash) — out of scope for this template.
 */
const CACHE_TTL_MS = 15_000;
let cached: { value: ISiteSettings; expiresAt: number } | null = null;

export async function getSettings(): Promise<ISiteSettings> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value = await SiteSettings.findOne();
  if (!value) {
    const created = await SiteSettings.create({
      siteName: "SMM Panel",
      minCreditAmount: 50,
      defaultMarkupPercent: 30,
      announcementText: "Welcome! Add funds to get started.",
      supportEmail: "support@smmpanel.com",
      maintenanceMode: false,
      updatedAt: new Date(),
    });
    value = created;
  }
  // Documents created before this setting existed lack the field in MongoDB;
  // normalise it so every consumer sees a usable number.
  if (value.defaultMarkupPercent == null) {
    value.defaultMarkupPercent = DEFAULT_MARKUP_PERCENT;
    await value.save().catch(() => undefined);
  }

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Call after any write to site_settings so subsequent reads aren't stale. */
export function invalidateSettingsCache() {
  cached = null;
  maintenanceCache = null;
}

/**
 * Lightweight, separately-cached boolean used on the `requireUser()` hot
 * path (every authenticated API call). Reading a single column instead of
 * the full settings row keeps the query — and the cached payload — as small
 * as possible.
 */
const MAINTENANCE_CACHE_TTL_MS = 20_000;
let maintenanceCache: { value: boolean; expiresAt: number } | null = null;

export async function getMaintenanceFlag(): Promise<boolean> {
  if (maintenanceCache && maintenanceCache.expiresAt > Date.now()) {
    return maintenanceCache.value;
  }
  const row = await SiteSettings.findOne().select({ maintenanceMode: 1 });
  const value = row?.maintenanceMode ?? false;
  maintenanceCache = { value, expiresAt: Date.now() + MAINTENANCE_CACHE_TTL_MS };
  return value;
}

/** Public (non-secret) subset of the site settings. */
export function publicSettings(settings: ISiteSettings) {
  return {
    siteName: settings.siteName,
    siteLogo: settings.siteLogo,
    minCreditAmount: Number(settings.minCreditAmount),
    announcementText: settings.announcementText,
    supportEmail: settings.supportEmail,
    maintenanceMode: settings.maintenanceMode,
  };
}
