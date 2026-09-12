import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { firstError, resetPasswordSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    // Rate-limit token-guessing on the consumption endpoint (keyed by client
    // IP via limitOrFail). Invalid/unknown tokens still return the same
    // generic 400 below, so enumeration behavior is unchanged.
    const limited = await limitOrFail(req, "passwordReset");
    if (limited) return fail(limited, 429);

    const parsed = resetPasswordSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { token, password } = parsed.data;

    const user = await User.findOne({ resetPasswordToken: token });

    if (!user) return fail("This reset link is invalid", 400);
    if (!user.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
      return fail("This reset link has expired", 400);
    }

    user.password = await hashPassword(password);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    // Invalidate every previously issued JWT (including a stolen session):
    // getCurrentUser() rejects tokens whose `sv` no longer matches.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();

    return ok({ email: user.email }, "Password updated — you can sign in now");
  });
}
