import mongoose from "mongoose";
import {
  User,
  Category,
  Service,
  Order,
  Transaction,
  SupportTicket,
  RateLimitBucket,
  SiteSettings,
  AdminAuditLog,
  SocialAccount,
  ScheduledPost,
  AnalyticsSnapshot,
} from "./mongodb-schema";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Standalone MongoDB servers (typical local `mongod`, some shared hosts) do
 * not support retryable writes — the driver then fails every write with
 * "This MongoDB deployment does not support retryable writes…". Atlas SRV
 * URIs and explicit `replicaSet=` URIs keep the (safer) driver default; all
 * other connection strings get `retryWrites: false` automatically so the app
 * works out of the box in development.
 */
function connectOptions(): Record<string, unknown> {
  const uri = MONGODB_URI ?? "";
  const looksReplicated = /\+srv/i.test(uri) || /replicaSet=/i.test(uri);
  return {
    serverSelectionTimeoutMS: 10_000,
    ...(looksReplicated ? {} : { retryWrites: false }),
  };
}

declare global {
  // Keep a single connection across Next.js hot reloads and serverless invocations.
   
  var mongooseConnectionPromise: Promise<typeof mongoose> | undefined;
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Add it to .env or your deployment environment.");
  }

  try {
    global.mongooseConnectionPromise ??= mongoose.connect(MONGODB_URI, connectOptions());
    await global.mongooseConnectionPromise;
    console.info("[db] connected to MongoDB");

    // Initialize the singleton settings document after the connection is ready.
    const settings = await SiteSettings.findOne();
    if (!settings) {
      await SiteSettings.create({
        siteName: "SMM Panel",
        siteLogo: null,
        minCreditAmount: 50,
        defaultMarkupPercent: 30,
        announcementText: "",
        supportEmail: null,
        maintenanceMode: false,
        updatedAt: new Date(),
      });
      console.info("[db] site settings initialized");
    }

    return mongoose.connection;
  } catch (error) {
    global.mongooseConnectionPromise = undefined;
    console.error("[db] MongoDB connection failed:", error);
    throw error;
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    global.mongooseConnectionPromise = undefined;
    console.info("[db] disconnected from MongoDB");
  }
}

export {
  User,
  Category,
  Service,
  Order,
  Transaction,
  SupportTicket,
  RateLimitBucket,
  SiteSettings,
  AdminAuditLog,
  SocialAccount,
  ScheduledPost,
  AnalyticsSnapshot,
};

export default mongoose;
