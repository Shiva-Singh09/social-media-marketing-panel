import { z } from "zod";

import { AdminNotification, NotificationEventType } from "@/db";
import { HttpError, requireAdmin } from "@/lib/auth";
import { handle, ok, parsePagination } from "@/lib/api";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/admin/notifications — list operational notifications.
//
// Scoped to the requesting admin, newest first, paginated (max 50/page). Never
// leaks another admin's notifications: `userId` is always the session's admin.
// ---------------------------------------------------------------------------

/** Hard ceiling for a single page — keeps the feed bounded and predictable. */
const MAX_PAGE_SIZE = 50;

const listQuerySchema = z.object({
  read: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  eventTypes: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }),
});

export async function GET(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const url = new URL(req.url);

    let filters: z.infer<typeof listQuerySchema>;
    try {
      filters = listQuerySchema.parse(Object.fromEntries(url.searchParams));
    } catch {
      throw new HttpError("Invalid query parameters", 400);
    }

    const { page, limit, offset } = parsePagination(url, 25);
    const cappedLimit = Math.min(limit, MAX_PAGE_SIZE);

    const query: Record<string, unknown> = { userId: admin._id };
    if (filters.read !== undefined) query.read = filters.read;
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      // Enum-validated by the model; unknown values simply match nothing.
      query.eventType = { $in: filters.eventTypes as NotificationEventType[] };
    }

    const [notifications, total] = await Promise.all([
      AdminNotification.find(query).sort({ createdAt: -1 }).skip(offset).limit(cappedLimit).lean(),
      AdminNotification.countDocuments(query),
    ]);

    return ok(
      {
        notifications: notifications.map((n) => ({
          id: String(n._id),
          eventType: n.eventType,
          severity: n.severity,
          title: n.title,
          message: n.message,
          orderId: n.orderId ? String(n.orderId) : null,
          relatedUserId: n.relatedUserId ? String(n.relatedUserId) : null,
          transactionId: n.transactionId ? String(n.transactionId) : null,
          read: Boolean(n.read),
          createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
        })),
        pagination: {
          page,
          limit: cappedLimit,
          total,
          hasMore: offset + notifications.length < total,
        },
      },
      "Notifications loaded",
    );
  });
}

