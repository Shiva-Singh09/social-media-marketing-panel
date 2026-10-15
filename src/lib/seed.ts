import mongoose from "mongoose";
import { User, Category, Service, RateLimitBucket } from "@/db/mongodb-schema";
import { hashPassword, HttpError } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

/**
 * Idempotent seeding (equivalent of `node seed/seedData.js`).
 *
 * Security note: there is NO hardcoded credential in this module. The admin
 * account is created only from `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment
 * variables — if they are missing, seeding fails loudly instead of silently
 * falling back to a well-known credential pair.
 *
 * Phase 2C-5: the optional demo customer account (`SEED_DEMO_USER`,
 * `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_STARTING_BALANCE`) was removed
 * completely, so startup can never recreate demo credentials. The
 * categories/services catalogue is still bootstrapped — the panel cannot take
 * an order without it — and only when the categories collection is empty.
 */
let seedPromise: Promise<void> | null = null;
let seedFailure: string | null = null;

const CATEGORY_SEED = [
  { name: "Instagram", platformKey: "instagram", icon: "instagram", sortOrder: 1 },
  { name: "YouTube", platformKey: "youtube", icon: "youtube", sortOrder: 2 },
  { name: "TikTok", platformKey: "tiktok", icon: "music", sortOrder: 3 },
  { name: "Facebook", platformKey: "facebook", icon: "facebook", sortOrder: 4 },
  { name: "Twitter/X", platformKey: "twitter", icon: "twitter", sortOrder: 5 },
  { name: "Telegram", platformKey: "telegram", icon: "send", sortOrder: 6 },
];

const SERVICE_SEED: Record<
  string,
  { name: string; price: number; min: number; max: number; description: string }[]
> = {
  Instagram: [
    {
      name: "IG Followers Premium",
      price: 20,
      min: 100,
      max: 50000,
      description: "High quality profiles, 0-6h start, 30 days refill guarantee.",
    },
    {
      name: "IG Likes (Indian)",
      price: 10,
      min: 50,
      max: 20000,
      description: "Real Indian accounts, instant start, no drop.",
    },
    {
      name: "IG Reel Views",
      price: 5,
      min: 500,
      max: 100000,
      description: "Fast reel views delivery with lifetime guarantee.",
    },
  ],
  YouTube: [
    {
      name: "YT Subscribers",
      price: 80,
      min: 100,
      max: 10000,
      description: "Non-drop subscribers, 24h start, 60 days refill.",
    },
    {
      name: "YT Views (Real)",
      price: 30,
      min: 500,
      max: 100000,
      description: "Monetizable real views from worldwide audience.",
    },
    {
      name: "YT Likes",
      price: 25,
      min: 50,
      max: 20000,
      description: "High retention likes, instant start.",
    },
  ],
  TikTok: [
    {
      name: "TT Followers",
      price: 15,
      min: 100,
      max: 50000,
      description: "Real looking followers, super fast delivery.",
    },
    {
      name: "TT Views",
      price: 3,
      min: 1000,
      max: 500000,
      description: "Cheapest views in the market, instant.",
    },
    {
      name: "TT Likes",
      price: 8,
      min: 100,
      max: 50000,
      description: "Boost engagement with instant likes.",
    },
  ],
  Facebook: [
    {
      name: "FB Page Likes",
      price: 45,
      min: 100,
      max: 20000,
      description: "Worldwide page likes with stable retention.",
    },
    {
      name: "FB Post Reactions",
      price: 18,
      min: 50,
      max: 10000,
      description: "Mixed reactions to boost reach.",
    },
  ],
  "Twitter/X": [
    {
      name: "X Followers",
      price: 60,
      min: 100,
      max: 20000,
      description: "Quality followers, 30 days refill.",
    },
    {
      name: "X Retweets",
      price: 22,
      min: 50,
      max: 10000,
      description: "Fast retweets for trending posts.",
    },
  ],
  Telegram: [
    {
      name: "TG Channel Members",
      price: 35,
      min: 100,
      max: 50000,
      description: "Real members, no bots, instant start.",
    },
    {
      name: "TG Post Views",
      price: 4,
      min: 500,
      max: 200000,
      description: "Last 5 posts views included.",
    },
  ],
};

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required to bootstrap the " +
        "admin account. Refusing to seed a hardcoded default credential.",
    );
  }
  if (adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long.");
  }

  const passwordHash = await hashPassword(adminPassword);

  // Try to create admin user; if already exists (unique email), just silently skip
  try {
    await User.create({
      name: "Panel Admin",
      email: adminEmail,
      password: passwordHash,
      role: "admin" as const,
      emailVerified: true,
      creditBalance: 0,
    });
  } catch (error: any) {
    // Ignore duplicate key error
    if (error.code !== 11000) throw error;
  }
}

async function seedCatalogue() {
  const existingCategories = await Category.findOne();
  if (existingCategories) return;

  const inserted = await Category.insertMany(CATEGORY_SEED);
  const rows = inserted.flatMap((cat) => {
    const list = SERVICE_SEED[cat.name] ?? [];
    return list.map((s) => ({
      categoryId: cat._id,
      name: s.name,
      description: s.description,
      pricePer1000: s.price,
      minQuantity: s.min,
      maxQuantity: s.max,
      status: "active" as const,
    }));
  });
  if (rows.length) await Service.insertMany(rows);
}

async function runSeed() {
  // Rate-limit bucket collection: opportunistically purge expired documents
  // so the collection doesn't grow unbounded.
  await RateLimitBucket.deleteMany({ resetAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }).catch(() =>
    undefined,
  );

  await getSettings();
  await seedAdmin();
  await seedCatalogue();
}

export function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedFailure = null;
    seedPromise = runSeed().catch((error: unknown) => {
      seedPromise = null;
      seedFailure = error instanceof Error ? error.message : "Unknown seeding error";
       
      console.error("[FATAL][seed:error]", seedFailure);
      // seedFailure can contain configuration details (env-var names,
      // generation commands, MongoDB/validation internals). Those stay in
      // server logs and in the HEALTH_SECRET-gated /api/health payload —
      // never in client-facing messages. Production clients receive a
      // generic 503; non-production keeps the detail for debugging.
      throw new HttpError(
        process.env.NODE_ENV === "production"
          ? "Service temporarily unavailable — please try again shortly."
          : `Server not initialized: ${seedFailure}`,
        503,
      );
    });
  }
  return seedPromise;
}

/** Non-throwing status check used by routes that want to surface a 503 instead of a 500. */
export function seedStatus(): { ready: boolean; error: string | null } {
  return { ready: seedPromise !== null && seedFailure === null, error: seedFailure };
}
