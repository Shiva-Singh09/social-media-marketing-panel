import { handle, ok } from "@/lib/api";
import { getCurrentUser, toSafeUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { getSettings, publicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded();
    const user = await getCurrentUser(req);
    const settings = await getSettings();
    return ok(
      { user: user ? toSafeUser(user) : null, settings: publicSettings(settings) },
      user ? "Session active" : "No active session",
    );
  });
}
