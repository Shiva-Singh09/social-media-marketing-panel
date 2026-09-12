/**
 * SMM Panel - Database schema (PostgreSQL / Drizzle ORM)
 *
 * Mirrors the documented Mongoose models 1:1:
 * User, Category, Service, Order, Transaction, SupportTicket (+ replies), SiteSettings
 *
 * All status/role/type columns use Postgres enums (not free-text) so invalid
 * values are rejected at the database layer, not just in application code.
 */
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "blocked"]);
export const contentStatusEnum = pgEnum("content_status", ["active", "inactive"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "processing",
  "in_progress",
  "completed",
  "partial",
  "cancelled",
  "failed",
]);
export const transactionTypeEnum = pgEnum("transaction_type", ["credit", "debit"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "success", "failed"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "replied", "closed"]);

/* ------------------------------ USERS ------------------------------ */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    password: text("password"), // nullable => google-only accounts
    googleId: text("google_id"),
    avatar: text("avatar"),
    creditBalance: numeric("credit_balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("active"),
    emailVerified: boolean("email_verified").notNull().default(false),
    verificationToken: text("verification_token"),
    resetPasswordToken: text("reset_password_token"),
    resetPasswordExpires: timestamp("reset_password_expires", { withTimezone: true }),
    lastLogin: timestamp("last_login", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_unique").on(table.email),
  }),
);

/* ---------------------------- CATEGORIES ---------------------------- */
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Immutable-by-convention slug (e.g. "instagram") used to key the social
  // link domain allowlist in src/lib/validators.ts. Unlike `name`, which an
  // admin can freely rename for display purposes, this key is what order
  // validation relies on — so renaming a category never silently disables
  // its link validation.
  platformKey: text("platform_key"),
  icon: text("icon"),
  status: contentStatusEnum("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------------- SERVICES ----------------------------- */
export const services = pgTable(
  "services",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    pricePer1000: numeric("price_per_1000", { precision: 12, scale: 2 }).notNull(),
    minQuantity: integer("min_quantity").notNull().default(100),
    maxQuantity: integer("max_quantity").notNull().default(50000),
    status: contentStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: index("services_category_idx").on(table.categoryId),
  }),
);

/* ------------------------------ ORDERS ------------------------------ */
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    link: text("link").notNull(),
    quantity: integer("quantity").notNull(),
    totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    startCount: integer("start_count"),
    remains: integer("remains"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("orders_user_idx").on(table.userId),
    statusIdx: index("orders_status_idx").on(table.status),
  }),
);

/* --------------------------- TRANSACTIONS --------------------------- */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    razorpayPaymentId: text("razorpay_payment_id"),
    razorpayOrderId: text("razorpay_order_id"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("transactions_user_idx").on(table.userId),
    rzpOrderIdx: index("transactions_rzp_order_idx").on(table.razorpayOrderId),
  }),
);

/* -------------------------- SUPPORT TICKETS -------------------------- */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("support_tickets_user_idx").on(table.userId),
  }),
);

export const ticketReplies = pgTable(
  "ticket_replies",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketIdx: index("ticket_replies_ticket_idx").on(table.ticketId),
  }),
);

/* --------------------------- SITE SETTINGS --------------------------- */
// NOTE: Razorpay credentials are intentionally NOT stored here — they live
// exclusively in server environment variables (see src/lib/razorpay.ts).
// Keeping payment secrets out of the database avoids leaking them via a SQL
// injection, a DB backup, or an over-permissioned admin settings endpoint.
export const siteSettings = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  siteName: text("site_name").notNull().default("SMM Panel"),
  siteLogo: text("site_logo"),
  minCreditAmount: numeric("min_credit_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("50"),
  announcementText: text("announcement_text").notNull().default(""),
  supportEmail: text("support_email"),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- RATE LIMIT BUCKETS ------------------------- */
// Backed by Postgres (not process memory) so limits are enforced consistently
// across multiple server instances/replicas.
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/* --------------------------- ADMIN AUDIT LOG --------------------------- */
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    adminIdx: index("admin_audit_logs_admin_idx").on(table.adminId),
  }),
);

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type TicketReply = typeof ticketReplies.$inferSelect;
export type SiteSettings = typeof siteSettings.$inferSelect;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
