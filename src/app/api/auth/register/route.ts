import crypto from "node:crypto";
import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { hashPassword, setSessionCookie, signToken, toSafeUser } from "@/lib/auth";
import { sendEmail, verifyEmailEmail } from "@/lib/mailer";
import { limitOrFail } from "@/lib/rate-limit";
import { ensureSeeded } from "@/lib/seed";
import { firstError, registerSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded();
    const limited = await limitOrFail(req, "register");
    if (limited) return fail(limited, 429);

    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { name, email, password } = parsed.data;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      // Deliberately generic — confirming that an email is already
      // registered lets an attacker enumerate real accounts.
      return fail(
        "Unable to create an account with these details. If you already have an account, please sign in instead.",
        200,
      );
    }

    const verificationToken = crypto.randomBytes(24).toString("hex");
    const created = await User.create({
      name,
      email: email.toLowerCase(),
      password: await hashPassword(password),
      verificationToken,
      lastLogin: new Date(),
    });

    const origin = process.env.FRONTEND_URL ?? new URL(req.url).origin;
    await sendEmail({
      to: created.email,
      subject: "Verify your SMM Panel email",
      html: verifyEmailEmail(created.name, `${origin}/api/auth/verify-email/${verificationToken}`),
    });

    const token = await signToken({
      sub: String(created._id),
      email: created.email,
      role: "user",
      sv: created.sessionVersion ?? 0,
    });
    await setSessionCookie(token);

    return ok(
      { user: toSafeUser(created) },
      "Account created — check your email to verify your address before placing orders.",
      201,
    );
  });
}
