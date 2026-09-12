import { fail, handle, ok } from "@/lib/api";
import { comparePassword, hashPassword, requireUser } from "@/lib/auth";
import { changePasswordSchema, firstError } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const parsed = changePasswordSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    if (user.password && !(await comparePassword(parsed.data.currentPassword, user.password))) return fail("Current password is incorrect", 401);
    user.password = await hashPassword(parsed.data.newPassword);
    // Invalidate all other sessions (e.g. a session on a lost device):
    // previously issued JWTs carry the old `sv` and are rejected from now on.
    // The caller's own cookie keeps working on the next login.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();
    return ok(null, "Password changed successfully");
  });
}
