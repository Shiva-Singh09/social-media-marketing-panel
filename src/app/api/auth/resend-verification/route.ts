import crypto from "node:crypto";
import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail, verifyEmailEmail } from "@/lib/mailer";
import { limitOrFail } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Uses `getCurrentUser` (not `requireUser`) deliberately — an unverified
 * user must still be able to request a new verification email even though
 * `requireUser` now blocks unverified accounts from every other endpoint.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await getCurrentUser(req);
    if (!user) return fail("Please sign in first", 401);
    if (user.emailVerified) return ok({ alreadyVerified: true }, "Your email is already verified");

    const limited = await limitOrFail(req, "support", `verify-resend-${user._id}`);
    if (limited) return fail(limited, 429);

    const verificationToken = crypto.randomBytes(24).toString("hex");
    await User.findByIdAndUpdate(user._id, { verificationToken });

    const origin = process.env.FRONTEND_URL ?? new URL(req.url).origin;
    const delivery = await sendEmail({
      to: user.email,
      subject: "Verify your SMM Panel email",
      html: verifyEmailEmail(user.name, `${origin}/api/auth/verify-email/${verificationToken}`),
    });

    return ok(
      {
        sent: true,
        verifyLink: delivery.delivered ? null : `${origin}/api/auth/verify-email/${verificationToken}`,
      },
      delivery.delivered
        ? "Verification email sent — please check your inbox."
        : "SMTP not configured — use the link below to verify.",
    );
  });
}
