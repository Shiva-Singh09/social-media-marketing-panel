import { handle, ok } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    await clearSessionCookie();
    return ok(null, "Signed out");
  });
}
