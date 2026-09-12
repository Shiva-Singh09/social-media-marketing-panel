import { fail, handle, ok } from "@/lib/api";
import { requireUser, toSafeUser } from "@/lib/auth";
import { firstError, updateProfileSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => ok({ user: toSafeUser(await requireUser(req)) }, "Profile loaded"));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const parsed = updateProfileSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    user.name = parsed.data.name;
    user.avatar = parsed.data.avatar || null;
    await user.save();
    return ok({ user: toSafeUser(user) }, "Profile updated");
  });
}
