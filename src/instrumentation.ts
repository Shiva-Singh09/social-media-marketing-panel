/**
 * Runs once when a new server instance boots, before any request is handled
 * (see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 * Connecting to MongoDB here and seeding the database avoids a startup race
 * where several concurrent requests could all kick off `runSeed()` before
 * the first one finishes.
 */

const REQUIRED_COLLECTIONS = [
  "users",
  "categories",
  "services",
  "orders",
  "transactions",
  "supportTickets",
  "rateLimitBuckets",
  "siteSettings",
  "adminAuditLogs",
];

async function checkMongoDBConnected() {
  const { connectDB, User, Category, Service, Order, Transaction, SupportTicket, RateLimitBucket, SiteSettings, AdminAuditLog } = await import("@/db");

  try {
    await connectDB();
     
    console.info("[startup] connected to MongoDB");
  } catch (error) {
     
    console.error("[startup] FATAL: MongoDB connection failed —", error);
    throw error;
  }

  // Verify collections exist by checking if we can query them
  const models = { users: User, categories: Category, services: Service, orders: Order, transactions: Transaction, supportTickets: SupportTicket, rateLimitBuckets: RateLimitBucket, siteSettings: SiteSettings, adminAuditLogs: AdminAuditLog };
  
  for (const [name, model] of Object.entries(models)) {
    try {
      await (model.collection as unknown as { stats(): Promise<unknown> }).stats();
    } catch (error) {
      // Collection may not exist yet (empty database), which is okay
       
      console.debug(`[startup] collection '${name}' not yet created (will be created on first write)`);
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail fast in production when security-critical env vars are missing or
  // weak. Messages name the variable, never its value.
  const { validateProductionEnv } = await import("@/lib/env");
  const envProblems = validateProductionEnv();
  if (envProblems.length > 0) {
    const message = `[startup] FATAL: invalid production environment:\n - ${envProblems.join("\n - ")}`;
    console.error(message);
    throw new Error(message);
  }

  try {
    await checkMongoDBConnected();
     
    console.info("[startup] database connection check passed");
  } catch (error) {
     
    console.error("[startup] FATAL: database check failed —", error);
    // Re-throw so the process/health check clearly reports a broken deploy
    // instead of silently serving traffic against a half-migrated database.
    throw error;
  }

  const { ensureSeeded } = await import("@/lib/seed");
  try {
    await ensureSeeded();
     
    console.info("[startup] database seed check complete");
  } catch (error) {
     
    console.error("[startup] FATAL: seeding failed —", error);
  }
}
