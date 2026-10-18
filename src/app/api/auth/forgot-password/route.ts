import crypto from "node:crypto";
import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { limitOrFail } from "@/lib/rate-limit";
import { resetPasswordEmail, sendEmail } from "@/lib/mailer";
import { firstError, forgotPasswordSchema } from "@/lib/validators";
import { hashSecurityToken } from "@/lib/security-tokens";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const limited = await limitOrFail(req, "passwordReset");
    if (limited) return fail(limited, 429);

    const parsed = forgotPasswordSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const user = await User.findOne({ email: parsed.data.email.toLowerCase() });

    // Always answer the same way so emails can't be enumerated.
    const genericMessage = "If that email exists, a reset link has been sent.";
    if (!user) return ok({ sent: true }, genericMessage);

    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = hashSecurityToken(token);
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const origin = process.env.FRONTEND_URL ?? new URL(req.url).origin;
    const link = `${origin}/reset-password/${token}`;
    const delivery = await sendEmail({
      to: user.email,
      subject: "Reset your SMM Panel password",
      html: resetPasswordEmail(user.name, link),
    });

    return ok(
      { sent: delivery.delivered },
      genericMessage,
    );
  });
}
