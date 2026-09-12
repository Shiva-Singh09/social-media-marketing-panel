import { User } from "@/db";
import { handle, num, ok, parsePagination } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePagination(url, 12);
    const search = url.searchParams.get("search")?.trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const rows = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const total = await User.countDocuments(filter);

    return ok(
      {
        users: rows.map((u: any) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          creditBalance: num(u.creditBalance),
          emailVerified: u.emailVerified,
          lastLogin: u.lastLogin,
          createdAt: u.createdAt,
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      },
      "Users loaded",
    );
  });
}