/**
 * SMM Panel - MongoDB Schema Conversion
 * 
 * Converted from PostgreSQL/Drizzle ORM to MongoDB/Mongoose
 * Maintains 1:1 field mapping and relationships using MongoDB references
 * and embedded documents where appropriate.
 * 
 * Status: This file defines the MongoDB schema structure only.
 * No backend logic has been modified.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_MARKUP_PERCENT } from '@/lib/pricing';

// ============================================================================
// ENUMS & TYPES
// ============================================================================

export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ContentStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const OrderStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const TransactionType = {
  CREDIT: 'credit',
  DEBIT: 'debit',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const PaymentStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const TicketStatus = {
  OPEN: 'open',
  REPLIED: 'replied',
  CLOSED: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

// ============================================================================
// INTERFACES
// ============================================================================

export interface ITicketReply {
  _id?: mongoose.Types.ObjectId;
  message: string;
  isAdmin: boolean;
  createdAt: Date;
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password?: string | null; // nullable => google-only accounts
  googleId?: string | null;
  avatar?: string | null;
  creditBalance: number; // stored as decimal/string in MongoDB
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  verificationToken?: string | null;
  resetPasswordToken?: string | null;
  resetPasswordExpires?: Date | null;
  /**
   * Login-abuse tracking (P1 auth hardening, Task 3). Short-lived,
   * self-expiring — never a permanent lock. See login route for policy.
   * Defaults keep legacy documents working with no migration.
   */
  failedLoginAttempts?: number;
  loginLockUntil?: Date | null;
  /**
   * Session/security version. Stamped into every newly issued JWT (`sv` claim)
   * and re-checked on each authenticated request in getCurrentUser().
   * Incremented after password reset / authenticated password change so all
   * previously issued JWTs stop validating. Defaults to 0 for legacy users.
   */
  sessionVersion?: number;
  lastLogin?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICategory extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  platformKey?: string | null; // immutable slug (e.g., "instagram")
  icon?: string | null;
  status: ContentStatus;
  sortOrder: number;
  createdAt: Date;
}

export interface IService extends Document {
  _id: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId; // reference to Category
  name: string;
  description?: string | null;
  pricePer1000: number;
  /**
   * Credit-system pricing (see src/lib/pricing.ts):
   *  - providerServiceId : numeric id at the SMM provider (action=add uses it)
   *  - providerCostPer1000: what the PROVIDER charges us per 1000 units
   *  - markupPercent      : margin added on top of provider cost (default 30)
   * User cost = quantity/1000 × providerCostPer1000 × (1 + markupPercent/100).
   * When providerCostPer1000 is null the panel falls back to pricePer1000.
   */
  providerServiceId?: number | null;
  providerCostPer1000?: number | null;
  markupPercent?: number;
  minQuantity: number;
  maxQuantity: number;
  status: ContentStatus;
  createdAt: Date;
}

export interface IOrder extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User
  serviceId: mongoose.Types.ObjectId; // reference to Service
  link: string;
  quantity: number;
  totalCost: number;
  status: OrderStatus;
  startCount?: number | null;
  remains?: number | null;
  /** Numeric order id returned by the SMM provider (automated orders). */
  smmOrderId?: number | null;
  /**
   * Wallet debit transaction that paid for this order (Phase 2C-1). A real
   * reference replacing the legacy free-text "Order #<id>" description
   * linkage, so reconciliation can reliably resolve "which exact debit
   * belongs to this order". Optional/nullable: legacy documents predate it
   * and the order-creation flow populates it in a later phase.
   */
  debitTransactionId?: mongoose.Types.ObjectId | null;
  /**
   * Client-supplied idempotency key (Phase 2C-1 foundation). Uniqueness is
   * scoped PER USER via a partial unique index (below) — different users may
   * reuse the same key. No route populates this yet; the behavioral wiring
   * (zod field + create-time claim) is a later phase.
   */
  clientRequestId?: string;
  /**
   * Worker automation state (Phase 2C-2). ALL fields persist on the document
   * so retries/claims survive process and deployment restarts — never
   * in-memory only.
   */
  /** Number of provider `add` submissions STARTED (incremented before each call). */
  smmAttempts?: number;
  /** Earliest time the worker may attempt the next submission. */
  nextRetryAt?: Date | null;
  /** Atomic worker claim expiry — two workers can never process one order. */
  workerClaimUntil?: Date | null;
  /** Sanitized last submission/provider failure (safe to store and show). */
  smmLastError?: string | null;
  /** Consecutive failed provider-status polls for an order in `processing`/`pending` with a smmOrderId. */
  pollFailCount?: number;
  /** True when the outcome is ambiguous/unrecoverable automatically — needs manual review. */
  needsReview?: boolean;
  /** Last raw provider status string observed during polling (observability). */
  smmStatus?: string | null;
  /**
   * True while a provider submission is in progress and its outcome is not
   * yet recorded (write-ahead marker). A claim that expires with this flag
   * still true means the process died mid-call → ambiguous → manual review.
   */
  submissionInFlight?: boolean;
  adminNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITransaction extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User
  type: TransactionType;
  amount: number;
  description?: string | null;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  /**
   * Refund idempotency (P2 hardening). Set ONLY on refund transactions: the
   * _id of the Order that was refunded. A sparse-unique index (below) makes
   * "one refund per order" a hard database constraint, so duplicate or
   * concurrent refund attempts are rejected with E11000 instead of
   * double-crediting a wallet. Deduplication must use this field — never the
   * mutable, free-form `description` string.
   */
  refundForOrderId?: mongoose.Types.ObjectId | null;
  paymentStatus: PaymentStatus;
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User
  subject: string;
  message: string;
  status: TicketStatus;
  replies: ITicketReply[]; // embedded array of replies
  createdAt: Date;
  updatedAt: Date;
}

export interface IRateLimitBucket extends Document {
  _id: any; // bucketKey as primary key (string)
  bucketKey: string;
  count: number;
  resetAt: Date;
}

export interface ISiteSettings extends Document {
  _id: mongoose.Types.ObjectId;
  siteName: string;
  siteLogo?: string | null;
  minCreditAmount: number;
  /** Global profit margin (%) added on top of provider cost for all services. */
  defaultMarkupPercent: number;
  announcementText: string;
  supportEmail?: string | null;
  maintenanceMode: boolean;
  updatedAt: Date;
}

export interface IAdminAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  adminId: mongoose.Types.ObjectId; // reference to User (admin)
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: string | null;
  createdAt: Date;
}

// ============================================================================
// MONGOOSE SCHEMAS
// ============================================================================

/**
 * USERS COLLECTION
 * Stores user account information, credentials, and authentication tokens
 */
const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, default: null }, // null for google-only accounts
    googleId: { type: String, default: null },
    avatar: { type: String, default: null },
    creditBalance: { type: Number, required: true, default: 0 },
    role: { 
      type: String, 
      enum: Object.values(UserRole),
      required: true, 
      default: UserRole.USER 
    },
    status: { 
      type: String, 
      enum: Object.values(UserStatus),
      required: true, 
      default: UserStatus.ACTIVE 
    },
    emailVerified: { type: Boolean, required: true, default: false },
    verificationToken: { type: String, default: null },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    // Login-abuse tracking (P1 auth hardening, Task 3). Legacy documents
    // without these fields read as 0/null via `??` in the login route —
    // no migration or backfill required.
    failedLoginAttempts: { type: Number, default: 0 },
    loginLockUntil: { type: Date, default: null },
    // Session invalidation counter (P1 auth hardening). Legacy documents
    // without this field read as 0 via `?? 0` in auth checks — no migration
    // or backfill required, and no existing session is broken by its absence.
    sessionVersion: { type: Number, default: 0 },
    lastLogin: { type: Date, default: null },
  },
  { 
    timestamps: true,
    collection: 'users',
  }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ googleId: 1 }, { sparse: true });

/**
 * CATEGORIES COLLECTION
 * Stores service categories (Instagram, TikTok, etc.)
 */
const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true },
    platformKey: { type: String, default: null }, // immutable slug
    icon: { type: String, default: null },
    status: { 
      type: String, 
      enum: Object.values(ContentStatus),
      required: true, 
      default: ContentStatus.ACTIVE 
    },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { 
    timestamps: true,
    collection: 'categories',
    _id: true,
  }
);

CategorySchema.index({ platformKey: 1 }, { sparse: true });
CategorySchema.index({ status: 1 });

/**
 * SERVICES COLLECTION
 * Stores individual services with pricing and quantity limits
 */
const ServiceSchema = new Schema<IService>(
  {
    categoryId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Category',
      required: true 
    },
    name: { type: String, required: true },
    description: { type: String, default: null },
    pricePer1000: { type: Number, required: true },
    // --- Credit-system pricing fields (see src/lib/pricing.ts) ---
    providerServiceId: { type: Number, default: null },
    providerCostPer1000: { type: Number, default: null },
    markupPercent: { type: Number, required: true, default: 30 },
    minQuantity: { type: Number, required: true, default: 100 },
    maxQuantity: { type: Number, required: true, default: 50000 },
    status: { 
      type: String, 
      enum: Object.values(ContentStatus),
      required: true, 
      default: ContentStatus.ACTIVE 
    },
  },
  { 
    timestamps: true,
    collection: 'services',
  }
);

ServiceSchema.index({ categoryId: 1 });
ServiceSchema.index({ status: 1 });

/**
 * ORDERS COLLECTION
 * Stores customer orders for services
 */
const OrderSchema = new Schema<IOrder>(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    serviceId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Service',
      required: true 
    },
    link: { type: String, required: true },
    quantity: { type: Number, required: true },
    totalCost: { type: Number, required: true },
    status: { 
      type: String, 
      enum: Object.values(OrderStatus),
      required: true, 
      default: OrderStatus.PENDING 
    },
    startCount: { type: Number, default: null },
    remains: { type: Number, default: null },
    /**
     * Numeric order id returned by the SMM provider. Deliberately NO schema
     * default: MongoDB sparse indexes skip only ABSENT fields — explicit
     * nulls share one null key and would collide under the unique sparse
     * index below (same pattern as Transaction.refundForOrderId). Orders
     * without a provider id leave this field absent.
     */
    smmOrderId: { type: Number },
    adminNote: { type: String, default: null },
    /** Real reference to the wallet debit transaction (see IOrder). */
    debitTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    /** Client idempotency key — absent unless supplied (see IOrder). */
    clientRequestId: { type: String },
    // ---- Worker automation state (Phase 2C-2) — persisted for restart safety ----
    smmAttempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null },
    workerClaimUntil: { type: Date, default: null },
    smmLastError: { type: String, default: null },
    needsReview: { type: Boolean, default: false },
    pollFailCount: { type: Number, default: 0, min: 0 },    smmStatus: { type: String, default: null },    submissionInFlight: { type: Boolean, default: false },
  },
  { 
    timestamps: true,
    collection: 'orders',
  }
);

OrderSchema.index({ userId: 1 });
OrderSchema.index({ serviceId: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ createdAt: -1 });
/**
 * Provider-order idempotency (Phase 2C-1): at most ONE local order may claim
 * a given external provider order id — a crash/retry that double-submits an
 * order to the SMM provider is rejected with E11000 instead of silently
 * creating two paid provider orders.
 *
 * Sparse is required (orders legitimately lack a provider id while
 * pending/failed) and the field therefore has NO schema default, because
 * MongoDB sparse indexes skip only ABSENT fields while explicit nulls are
 * indexed and would collide (same reasoning as Transaction.refundForOrderId).
 *
 * Existing-data risk: documents written BEFORE this change carry an explicit
 * `smmOrderId: null` (old schema default). If two or more such documents
 * exist when this index is built, the build fails with E11000 on null and
 * the index simply stays absent until the planned controlled DB reset
 * removes those documents. No data is modified in this phase.
 */
OrderSchema.index({ smmOrderId: 1 }, { unique: true, sparse: true });
/**
 * Request-idempotency foundation (Phase 2C-1): per-user uniqueness of a
 * client-supplied key. A partialFilterExpression (NOT `sparse`) is required
 * for compound uniqueness over an optional field — a compound sparse index
 * would still index every document (userId is always present) and collide
 * on the missing clientRequestId. No route populates this field yet, so the
 * index stays empty until the later idempotency phase wires it in.
 */
OrderSchema.index(
  { userId: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string' } },
  },
);
/**
 * Worker queue index (Phase 2C-2): both worker queries select on
 * (status, smmOrderId) — submission (status=pending, smmOrderId absent) and
 * status polling (smmOrderId present, status active). Keeps cron candidate
 * scans bounded and cheap.
 */
OrderSchema.index({ status: 1, smmOrderId: 1 });

/**
 * TRANSACTIONS COLLECTION
 * Stores credit transactions (payments, refunds, adjustments)
 */
const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    type: { 
      type: String, 
      enum: Object.values(TransactionType),
      required: true 
    },
    amount: { type: Number, required: true },
    description: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    razorpayOrderId: { type: String, default: null },
    /**
     * Refund idempotency (P2): the Order this refund belongs to. Undefined
     * (absent) for payments/debits — deliberately NO schema default, because
     * Mongoose would persist explicit `null`s and a sparse-unique index skips
     * only ABSENT fields (explicit nulls share one null key and would collide
     * under uniqueness). Refund transactions set this explicitly.
     */
    refundForOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    paymentStatus: { 
      type: String, 
      enum: Object.values(PaymentStatus),
      required: true, 
      default: PaymentStatus.PENDING 
    },
  },
  { 
    timestamps: true,
    collection: 'transactions',
  }
);

TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ razorpayOrderId: 1 }, { sparse: true });
/**
 * Refund idempotency constraint (P2): at most ONE refund transaction per
 * order. Sparse → nulls (payments, admin adjustments) are unindexed and can
 * repeat freely; a second refund for the same order is rejected with E11000,
 * which aborts the surrounding financial transaction and rolls back any
 * partial credit — the backstop behind the conditional status-claim latch in
 * the admin order-update route.
 */
TransactionSchema.index(
  { refundForOrderId: 1 },
  { unique: true, sparse: true },
);
TransactionSchema.index({ createdAt: -1 });

/**
 * TICKET REPLIES (embedded subdocument schema)
 * Replies within support tickets
 */
const TicketReplySchema = new Schema<ITicketReply>(
  {
    message: { type: String, required: true },
    isAdmin: { type: Boolean, required: true, default: false },
  },
  { 
    timestamps: true,
    _id: true,
  }
);

/**
 * SUPPORT TICKETS COLLECTION
 * Stores customer support tickets with embedded replies
 * NOTE: Replies are embedded in the ticket document (denormalized)
 * for better query performance and atomic updates
 */
const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { 
      type: String, 
      enum: Object.values(TicketStatus),
      required: true, 
      default: TicketStatus.OPEN 
    },
    replies: [TicketReplySchema], // embedded array of replies
  },
  { 
    timestamps: true,
    collection: 'supportTickets',
  }
);

SupportTicketSchema.index({ userId: 1 });
SupportTicketSchema.index({ status: 1 });
SupportTicketSchema.index({ createdAt: -1 });

/**
 * RATE LIMIT BUCKETS COLLECTION
 * Stores rate limiting state across instances
 * Uses bucketKey as string ID for atomic operations
 */
const RateLimitBucketSchema = new Schema<IRateLimitBucket>(
  {
    _id: { type: String }, // bucketKey as _id (e.g., "ip:192.168.1.1" or "user:123")
    bucketKey: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { 
    collection: 'rateLimitBuckets',
    timestamps: false,
  }
);

RateLimitBucketSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

/**
 * SITE SETTINGS COLLECTION
 * Stores global site configuration
 * NOTE: Razorpay credentials are NOT stored here; they live in env vars
 */
const SiteSettingsSchema = new Schema<ISiteSettings>(
  {
    siteName: { type: String, required: true, default: 'SMM Panel' },
    siteLogo: { type: String, default: null },
    minCreditAmount: { type: Number, required: true, default: 50 },
    // Global profit margin over provider cost (see src/lib/pricing.ts).
    // Per-service markupPercent overrides this when set.
    defaultMarkupPercent: { type: Number, required: true, default: DEFAULT_MARKUP_PERCENT },
    // An empty announcement means the banner is disabled, so it must be valid.
    announcementText: { type: String, default: '' },
    supportEmail: { type: String, default: null },
    maintenanceMode: { type: Boolean, required: true, default: false },
  },
  { 
    timestamps: false,
    collection: 'siteSettings',
  }
);

// Override updatedAt manually if needed
SiteSettingsSchema.add({ updatedAt: { type: Date, default: Date.now } });

/**
 * ADMIN AUDIT LOGS COLLECTION
 * Stores admin actions for compliance and debugging
 */
const AdminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    adminId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, default: null },
    details: { type: String, default: null },
  },
  { 
    timestamps: true,
    collection: 'adminAuditLogs',
  }
);

AdminAuditLogSchema.index({ adminId: 1 });
AdminAuditLogSchema.index({ createdAt: -1 });

// ==============================================================================
// ADMIN NOTIFICATIONS
// Operational notifications for admin observability (Phase 2C-6).
// Admin-visible alerts for genuinely actionable conditions: permanent provider
// submission failures, orders needing review, max-retry exhaustion, ambiguous
// provider results, and repeated status-polling failures. NOT a user-facing
// inbox — every notification is addressed to a recipient admin user.
// ==============================================================================

/** Deterministic event categories for admin notifications. */
export const NotificationEventType = {
  /** Provider submission permanently rejected the order (4xx non-429). */
  OrderPermanentFailure: "order.permanentFailure",
  /** Order parked for manual review (ambiguous outcome / max retries exhausted). */
  OrderNeedsReview: "order.needsReview",
  /** Order reached MAX_SUBMISSION_ATTEMPTS without a definitive result. */
  OrderMaxRetries: "order.maxRetries",
  /** Provider returned an ambiguous result that cannot be auto-resolved. */
  OrderAmbiguousResult: "order.ambiguousResult",
  /** Provider status polling failed N consecutive times for an order. */
  OrderPollingFailed: "order.pollingFailed",
} as const;
export type NotificationEventType = (typeof NotificationEventType)[keyof typeof NotificationEventType];

/** Severity levels for triage prioritisation. */
export const NotificationSeverity = {
  Info: "info",
  Warning: "warning",
  Critical: "critical",
} as const;
export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

/** Metadata fields that are safe to store for diagnostics. No secrets. */
export type NotificationMetadata = {
  smmProviderKind?: string;
  smmProviderCode?: number | string;
  smmProviderMessage?: string;
  smmAttempt?: number;
  pollFailureCount?: number;
  failReason?: string;
  workerBatchDue?: number;
  workerBatchClaimed?: number;
  workerBatchErrors?: string[];
  [key: string]: unknown;
};

export interface IAdminNotification extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // admin user who should see this
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  orderId?: mongoose.Types.ObjectId | null;
  relatedUserId?: mongoose.Types.ObjectId | null; // user who owns the affected order/transaction
  transactionId?: mongoose.Types.ObjectId | null;
  read: boolean;
  /** Deterministic key — unique, idempotent. `<logicalEventKey>:<recipientAdminId>`. */
  eventKey: string;
  /** Optional diagnostics metadata. No passwords, tokens, API keys, or secrets. */
  metadata?: NotificationMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

const AdminNotificationSchema = new Schema<IAdminNotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    eventType: {
      type: String,
      required: true,
      enum: Object.values(NotificationEventType),
    },
    severity: {
      type: String,
      required: true,
      enum: Object.values(NotificationSeverity),
      default: NotificationSeverity.Info,
    },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 4000 },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    relatedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    read: { type: Boolean, required: true, default: false, index: true },
    eventKey: { type: String, required: true, maxlength: 256, unique: true },
    metadata: {
      type: Object,
      default: null,
      validate: {
        validator: function (value: unknown): boolean {
          if (value === null || value === undefined) return true;
          if (typeof value !== "object" || Array.isArray(value)) return false;
          const keys = Object.keys(value as Record<string, unknown>);
          const forbidden = new Set([
            "password", "apiKey", "api_secret", "secret", "token", "accessToken",
            "refreshToken", "razorpaySecret", "encryptionKey", "privateKey",
          ]);
          return !keys.some((k) => forbidden.has(k.toLowerCase().trim()));
        },
        message:
          "Notification metadata must not contain secret-bearing fields (password, apiKey, secret, token, etc.)",
      },
    },
  },
  { timestamps: true },
);

// List/read-timeline index: "notifications for admin X, newest first, optionally filtered by read status".
AdminNotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
// Unread-count index: fast COUNT of unread notifications per admin.
AdminNotificationSchema.index({ userId: 1, read: 1 });
// Reverse-chronological feed for "recent operational events" across the panel.
AdminNotificationSchema.index({ createdAt: -1 });

export const AdminNotification = (
  mongoose.models.AdminNotification as mongoose.Model<IAdminNotification> ||
  mongoose.model<IAdminNotification>("AdminNotification", AdminNotificationSchema)
);

// ============================================================================

// Reuse existing models during Next.js development hot reloads.
export const User = (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>('User', UserSchema);
export const Category = (mongoose.models.Category as mongoose.Model<ICategory>) || mongoose.model<ICategory>('Category', CategorySchema);
export const Service = (mongoose.models.Service as mongoose.Model<IService>) || mongoose.model<IService>('Service', ServiceSchema);
export const Order = (mongoose.models.Order as mongoose.Model<IOrder>) || mongoose.model<IOrder>('Order', OrderSchema);
export const Transaction = (mongoose.models.Transaction as mongoose.Model<ITransaction>) || mongoose.model<ITransaction>('Transaction', TransactionSchema);
export const SupportTicket = (mongoose.models.SupportTicket as mongoose.Model<ISupportTicket>) || mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
export const RateLimitBucket = (mongoose.models.RateLimitBucket as mongoose.Model<IRateLimitBucket>) || mongoose.model<IRateLimitBucket>('RateLimitBucket', RateLimitBucketSchema);
export const SiteSettings = (mongoose.models.SiteSettings as mongoose.Model<ISiteSettings>) || mongoose.model<ISiteSettings>('SiteSettings', SiteSettingsSchema);
export const AdminAuditLog = (mongoose.models.AdminAuditLog as mongoose.Model<IAdminAuditLog>) || mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);

// ============================================================================
// SMM INTEGRATION COLLECTIONS
// Social accounts, scheduled posts, and analytics snapshots used by the
// /api/posts/schedule, /api/analytics/fetch and /api/accounts/manage routes.
// ============================================================================

export const SocialPlatform = {
  INSTAGRAM: 'instagram',
  YOUTUBE: 'youtube',
  TIKTOK: 'tiktok',
  FACEBOOK: 'facebook',
  TWITTER: 'twitter',
  TELEGRAM: 'telegram',
  OTHER: 'other',
} as const;
export type SocialPlatform = (typeof SocialPlatform)[keyof typeof SocialPlatform];

export const AccountStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const ScheduledPostStatus = {
  /** Waiting for its scheduledAt time to arrive. */
  SCHEDULED: 'scheduled',
  /** Handed to the provider (boost order placed), awaiting completion. */
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type ScheduledPostStatus = (typeof ScheduledPostStatus)[keyof typeof ScheduledPostStatus];

export const AnalyticsSource = {
  MANUAL: 'manual',
  WEBHOOK: 'webhook',
  PROVIDER: 'provider',
} as const;
export type AnalyticsSource = (typeof AnalyticsSource)[keyof typeof AnalyticsSource];

/**
 * SOCIAL ACCOUNTS COLLECTION
 * A user's connected social-media identities. OAuth tokens are stored ONLY in
 * encrypted form (`accessTokenEnc` / `refreshTokenEnc`, AES-256-GCM via
 * src/lib/crypto.ts) — plaintext tokens are never persisted or returned.
 */
export interface ISocialAccount extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User
  platform: SocialPlatform;
  handle: string; // @username / page name (sanitized)
  externalId?: string | null; // platform-side user/page id when known
  accessTokenEnc?: string | null; // AES-256-GCM ciphertext
  refreshTokenEnc?: string | null; // AES-256-GCM ciphertext
  tokenExpiresAt?: Date | null;
  status: AccountStatus; // paused accounts are skipped by the scheduler
  meta?: Record<string, unknown> | null; // avatar url, follower count, etc.
  createdAt: Date;
  updatedAt: Date;
}

/**
 * SCHEDULED POSTS COLLECTION
 * Content queued for publishing at a future time, optionally with a "boost"
 * order placed through the SMM provider when the post goes live.
 */
export interface IScheduledPost extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User
  accountId: mongoose.Types.ObjectId; // reference to SocialAccount
  platform: SocialPlatform;
  content: string;
  mediaUrls: string[];
  scheduledAt: Date;
  status: ScheduledPostStatus;
  boost?: {
    serviceId: number; // numeric provider service id
    link?: string | null;
    quantity: number;
    runs?: number | null; // drip-feed chunk count
    interval?: number | null; // drip-feed minutes between runs
  } | null;
  smmOrderId?: number | null; // provider order id once placed
  smmRefillId?: number | null;
  lastError?: string | null; // sanitized failure reason (safe to show)
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ANALYTICS SNAPSHOTS COLLECTION
 * Point-in-time metric captures (likes/comments/reach/...) per account, post
 * or panel order. Snapshots are append-only so trends can be charted over
 * any window without recomputing history.
 */
export interface IAnalyticsSnapshot extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // reference to User (owner)
  accountId?: mongoose.Types.ObjectId | null; // reference to SocialAccount
  postId?: mongoose.Types.ObjectId | null; // reference to ScheduledPost
  orderId?: mongoose.Types.ObjectId | null; // reference to Order (panel orders)
  likes: number;
  comments: number;
  shares?: number | null;
  reach: number;
  impressions?: number | null;
  followers?: number | null;
  source: AnalyticsSource;
  capturedAt: Date;
  createdAt: Date;
}

const SocialAccountSchema = new Schema<ISocialAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: {
      type: String,
      enum: Object.values(SocialPlatform),
      required: true,
    },
    handle: { type: String, required: true },
    externalId: { type: String, default: null },
    accessTokenEnc: { type: String, default: null }, // ciphertext only
    refreshTokenEnc: { type: String, default: null }, // ciphertext only
    tokenExpiresAt: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      required: true,
      default: AccountStatus.ACTIVE,
    },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'socialAccounts',
  }
);

// One connection per (user, platform, handle); speeds up owner-scoped lists.
SocialAccountSchema.index({ userId: 1, platform: 1, handle: 1 });
SocialAccountSchema.index({ userId: 1, status: 1 });

const ScheduledPostSchema = new Schema<IScheduledPost>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    platform: {
      type: String,
      enum: Object.values(SocialPlatform),
      required: true,
    },
    content: { type: String, required: true },
    mediaUrls: { type: [String], default: [] },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(ScheduledPostStatus),
      required: true,
      default: ScheduledPostStatus.SCHEDULED,
    },
    boost: {
      type: new Schema(
        {
          serviceId: { type: Number, required: true },
          link: { type: String, default: null },
          quantity: { type: Number, required: true },
          runs: { type: Number, default: null },
          interval: { type: Number, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    smmOrderId: { type: Number, default: null },
    smmRefillId: { type: Number, default: null },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'scheduledPosts',
  }
);

// The cron query: due + still-scheduled posts, oldest first.
ScheduledPostSchema.index({ status: 1, scheduledAt: 1 });
ScheduledPostSchema.index({ userId: 1, createdAt: -1 });

const AnalyticsSnapshotSchema = new Schema<IAnalyticsSnapshot>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'SocialAccount', default: null },
    postId: { type: Schema.Types.ObjectId, ref: 'ScheduledPost', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    likes: { type: Number, required: true, default: 0 },
    comments: { type: Number, required: true, default: 0 },
    shares: { type: Number, default: null },
    reach: { type: Number, required: true, default: 0 },
    impressions: { type: Number, default: null },
    followers: { type: Number, default: null },
    source: {
      type: String,
      enum: Object.values(AnalyticsSource),
      required: true,
      default: AnalyticsSource.MANUAL,
    },
    capturedAt: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'analyticsSnapshots',
  }
);

// Trend queries are always (owner, entity, time-window) shaped.
AnalyticsSnapshotSchema.index({ userId: 1, accountId: 1, capturedAt: -1 });
AnalyticsSnapshotSchema.index({ userId: 1, postId: 1, capturedAt: -1 });
AnalyticsSnapshotSchema.index({ capturedAt: -1 });

// Reuse existing models during Next.js development hot reloads.
export const SocialAccount = (mongoose.models.SocialAccount as mongoose.Model<ISocialAccount>) || mongoose.model<ISocialAccount>('SocialAccount', SocialAccountSchema);
export const ScheduledPost = (mongoose.models.ScheduledPost as mongoose.Model<IScheduledPost>) || mongoose.model<IScheduledPost>('ScheduledPost', ScheduledPostSchema);
export const AnalyticsSnapshot = (mongoose.models.AnalyticsSnapshot as mongoose.Model<IAnalyticsSnapshot>) || mongoose.model<IAnalyticsSnapshot>('AnalyticsSnapshot', AnalyticsSnapshotSchema);
