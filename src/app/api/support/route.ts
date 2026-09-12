import { SupportTicket } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { createTicketSchema, firstError } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const rows = await SupportTicket.find({ userId: user._id }).sort({ updatedAt: -1 }).lean();
    return ok({ tickets: rows.map((ticket) => ({ ...ticket, id: String(ticket._id), userId: String(ticket.userId), replyCount: ticket.replies?.length ?? 0 })) }, "Tickets loaded");
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "support", `user-${user._id}`);
    if (limited) return fail(limited, 429);
    const parsed = createTicketSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const ticket = await SupportTicket.create({ userId: user._id, subject: parsed.data.subject, message: parsed.data.message, status: "open", replies: [] });
    return ok({ ticket: { ...ticket.toObject(), id: String(ticket._id), userId: String(ticket.userId) } }, "Ticket created — our team will reply soon", 201);
  });
}
