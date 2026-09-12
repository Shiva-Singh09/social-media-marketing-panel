import { SiteSettings, Service } from "@/db";
import { recordAudit } from "@/lib/audit";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { isRazorpayConfigured } from "@/lib/razorpay";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { firstError, settingsSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * Note: Razorpay/SMTP/Google credentials are intentionally NOT exposed or
 * editable here — they only ever come from server environment variables
 * (see src/lib/razorpay.ts, src/lib/mailer.ts). This endpoint only manages
 * non-secret branding/business settings.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const settings = await getSettings();
    return ok(
      {
        settings,
        integrations: {
          razorpay: isRazorpayConfigured(),
          google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        },
      },
      "Settings loaded",
    );
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const parsed = settingsSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const current = await getSettings();
    const updated = await SiteSettings.findByIdAndUpdate(
      current._id,
      {
        siteName: parsed.data.siteName,
        siteLogo: parsed.data.siteLogo || null,
        minCreditAmount: parsed.data.minCreditAmount,
        defaultMarkupPercent: parsed.data.defaultMarkupPercent ?? current.defaultMarkupPercent ?? 30,
        announcementText: parsed.data.announcementText ?? "",
        supportEmail: parsed.data.supportEmail || null,
        maintenanceMode: parsed.data.maintenanceMode,
        updatedAt: new Date(),
      },
      { returnDocument: "after" },
    );

    // When the profit margin changes, re-price EVERY service so listings,
    // previews and charges move together instantly (they all read the same
    // cost × margin). Provider-linked services keep stored pricePer1000 in
    // sync with their provider rate; manual services keep pricePer1000 as
    // the cost basis and only get the new margin.
    let servicesUpdated = 0;
    const newMargin = parsed.data.defaultMarkupPercent;
    if (newMargin !== undefined && Math.abs(newMargin - (current.defaultMarkupPercent ?? 30)) > 0.0001) {
      const linked = await Service.updateMany(
        { providerServiceId: { $ne: null } },
        [
          {
            $set: {
              markupPercent: newMargin,
              pricePer1000: {
                $round: [{ $multiply: ["$providerCostPer1000", 1 + newMargin / 100] }, 2],
              },
            },
          },
        ],
        { updatePipeline: true },
      );
      const manual = await Service.updateMany(
        { providerServiceId: null },
        { $set: { markupPercent: newMargin } },
      );
      servicesUpdated = (linked.modifiedCount ?? 0) + (manual.modifiedCount ?? 0);
    }

    invalidateSettingsCache();
    await recordAudit({
      adminId: String(admin._id),
      action: "settings.update",
      targetType: "site_settings",
      targetId: String(current._id),
      details: { ...parsed.data, servicesRepriced: servicesUpdated || undefined },
    });

    return ok({ settings: updated!, servicesUpdated }, "Settings saved");
  });
}
