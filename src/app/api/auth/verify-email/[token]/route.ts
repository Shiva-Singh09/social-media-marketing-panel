import { User } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Opened directly from the verification email link in a browser tab, so this
 * redirects to a friendly page instead of returning a raw JSON API response.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const origin = new URL(req.url).origin;
  const { token } = await ctx.params;

  const user = await User.findOne({ verificationToken: token });

  if (!user) {
    return Response.redirect(`${origin}/login?verify=invalid`, 302);
  }

  user.emailVerified = true;
  user.verificationToken = null;
  await user.save();

  return Response.redirect(`${origin}/login?verify=success`, 302);
}
