import { SupportTicket } from "@/db";
import { handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { asEnumValue, TICKET_STATUSES } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const url = new URL(req.url);
    const status = asEnumValue(url.searchParams.get("status"), TICKET_STATUSES);

    const filter = status ? { status } : {};
    const rows = await SupportTicket.find(filter)
      .populate("userId", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    return ok(
      {
        tickets: rows.map((t: any) => ({
          id: t._id,
          subject: t.subject,
          message: t.message,
          status: t.status,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          userName: t.userId?.name,
          userEmail: t.userId?.email,
          replyCount: t.replies?.length ?? 0,
        })),
      },
      "Tickets loaded",
    );
  });
}