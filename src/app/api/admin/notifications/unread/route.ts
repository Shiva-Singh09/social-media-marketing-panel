import { AdminNotification } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications/unread
 * Unread operational-notification count for the requesting admin only.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const unreadCount = await AdminNotification.countDocuments({
      userId: admin._id,
      read: false,
    });
    return ok({ unreadCount }, "Unread notification count loaded");
  });
}

