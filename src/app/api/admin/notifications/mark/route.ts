import { z } from "zod";

import { AdminNotification } from "@/db";
import { HttpError, requireAdmin } from "@/lib/auth";
import { handle, ok } from "@/lib/api";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST / PATCH /api/admin/notifications/mark
 *
 * Mark one notification read (`{ id }`) or all of the requesting admin's
 * notifications read (`{ all: true }`). Every filter is scoped to the
 * requesting admin's `userId`, so another admin's notification is
 * indistinguishable from a missing one — a foreign id yields 404, never data
 * and never a leak of existence.
 */

const markSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, "Invalid notification id")
      .optional(),
    all: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.all) !== Boolean(body.id), {
    message: "Provide exactly one of 'id' or 'all'",
  });

async function markHandler(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);

    let body: z.infer<typeof markSchema>;
    try {
      body = markSchema.parse(await req.json());
    } catch {
      throw new HttpError("Provide exactly one of 'id' or 'all'", 400);
    }

    if (body.all) {
      const result = await AdminNotification.updateMany(
        { userId: admin._id, read: false },
        { $set: { read: true } },
      );
      const modified = result.modifiedCount ?? 0;
      await recordAudit({
        adminId: String(admin._id),
        action: "notifications.markAllRead",
        targetType: "adminNotification",
        targetId: null,
        details: { modified },
      });
      return ok({ modified }, "All notifications marked read");
    }

    const result = await AdminNotification.updateOne(
      { _id: body.id, userId: admin._id, read: false },
      { $set: { read: true } },
    );
    if (!result.modifiedCount) {
      // Missing, already read, or owned by another admin — never disclosed.
      throw new HttpError("Notification not found", 404);
    }
    await recordAudit({
      adminId: String(admin._id),
      action: "notification.markRead",
      targetType: "adminNotification",
      targetId: body.id ?? null,
      details: null,
    });
    return ok({ modified: 1 }, "Notification marked read");
  });
}

export async function POST(req: Request) {
  return markHandler(req);
}

export async function PATCH(req: Request) {
  return markHandler(req);
}

