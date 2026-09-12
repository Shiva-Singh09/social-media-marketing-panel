import { Transaction } from "@/db";
import { handle, num, ok, parsePagination } from "@/lib/api";
import { requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return handle(async () => { const user = await requireUser(req); const { page, limit, offset } = parsePagination(new URL(req.url)); const type = new URL(req.url).searchParams.get("type"); const filter: Record<string, unknown> = { userId: user._id }; if (type === "credit" || type === "debit") filter.type = type; const [rows, total] = await Promise.all([Transaction.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(), Transaction.countDocuments(filter)]); return ok({ transactions: rows.map((t) => ({ ...t, amount: num(t.amount), id: String(t._id), userId: String(t.userId) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } }, "Transaction history loaded"); }); }
