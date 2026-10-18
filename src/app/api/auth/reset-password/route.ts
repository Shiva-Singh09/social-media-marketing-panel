import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { firstError, resetPasswordSchema } from "@/lib/validators";
import { hashSecurityToken } from "@/lib/security-tokens";

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

    const user = await User.findOneAndUpdate(
      {
        $or: [
          { resetPasswordToken: hashSecurityToken(token) },
          { resetPasswordToken: token },
        ],
        resetPasswordExpires: { $gt: new Date() },
      },
      {
        $set: {
          password: await hashPassword(password),
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
        $inc: { sessionVersion: 1 },
      },
      { returnDocument: "after" },
    );

    if (!user) return fail("This reset link is invalid or expired", 400);

    return ok({ email: user.email }, "Password updated — you can sign in now");
  });
}
