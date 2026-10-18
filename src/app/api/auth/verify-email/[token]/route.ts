import { User } from "@/db";
import { hashSecurityToken } from "@/lib/security-tokens";

export const dynamic = "force-dynamic";

/**
 * Opened directly from the verification email link in a browser tab, so this
 * redirects to a friendly page instead of returning a raw JSON API response.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const origin = new URL(req.url).origin;
  const { token } = await ctx.params;

  const user = await User.findOneAndUpdate(
    {
      $or: [
        { verificationToken: hashSecurityToken(token) },
        { verificationToken: token },
      ],
      verificationTokenExpires: { $gt: new Date() },
      emailVerified: false,
    },
    {
      $set: {
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpires: null,
      },
    },
    { returnDocument: "after" },
  );

  if (!user) {
    return Response.redirect(`${origin}/login?verify=invalid`, 302);
  }

  return Response.redirect(`${origin}/login?verify=success`, 302);
}
