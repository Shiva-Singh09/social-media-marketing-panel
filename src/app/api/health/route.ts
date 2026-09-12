import mongoose, { connectDB } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Public shape stays minimal on purpose — no internal error messages, stack
 * traces, or connection details are ever exposed to an unauthenticated
 * caller. Set HEALTH_SECRET and pass `Authorization: Bearer <secret>` to get
 * a more detailed diagnostic payload (useful for internal monitoring).
 */
export async function GET(req: Request) {
  const started = Date.now();
  try {
    await connectDB();
    await mongoose.connection.db?.admin().ping();
  } catch (error) {
     
    console.error("[health:error]", error);
    return Response.json({ ok: false }, { status: 500 });
  }

  const healthSecret = process.env.HEALTH_SECRET;
  const authHeader = req.headers.get("authorization");
  const isAuthorized = Boolean(healthSecret) && authHeader === `Bearer ${healthSecret}`;

  if (!isAuthorized) {
    return Response.json({ ok: true });
  }

  const { seedStatus } = await import("@/lib/seed");
  return Response.json({
    ok: true,
    latencyMs: Date.now() - started,
    seed: seedStatus(),
    env: process.env.NODE_ENV,
  });
}
