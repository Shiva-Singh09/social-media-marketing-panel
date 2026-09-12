/**
 * SMM Panel - MongoDB Examples & Migration Guide
 * 
 * This file contains:
 * 1. Example MongoDB documents mirroring the PostgreSQL structure
 * 2. Migration notes and relationship mappings
 * 3. Indexing strategy
 * 4. Validation rules
 */

// ============================================================================
// EXAMPLE INSERT STATEMENTS
// ============================================================================

/**
 * USERS Collection - Example Documents
 * Maps from PostgreSQL users table
 */
const exampleUsers = [
  {
    _id: "507f1f77bcf86cd799439011", // MongoDB ObjectId (auto-generated)
    name: "John Doe",
    email: "john@example.com",
    password: "$2b$10$...", // bcrypt hash
    googleId: null,
    avatar: "https://example.com/avatars/john.jpg",
    creditBalance: "1500.50", // Decimal128 converted to string
    role: "user",
    status: "active",
    emailVerified: true,
    verificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    lastLogin: "2024-08-14T10:30:00.000Z",
    createdAt: "2024-01-15T08:00:00.000Z",
    updatedAt: "2024-08-14T10:30:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439012",
    name: "Admin User",
    email: "admin@example.com",
    password: "$2b$10$...",
    googleId: null,
    avatar: null,
    creditBalance: "0",
    role: "admin",
    status: "active",
    emailVerified: true,
    verificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    lastLogin: "2024-08-14T09:15:00.000Z",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-08-14T09:15:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439013",
    name: "Google User",
    email: "google@example.com",
    password: null, // Google-only account
    googleId: "google-oauth2|507f1f77bcf86cd799439013",
    avatar: "https://lh3.googleusercontent.com/a/...",
    creditBalance: "0",
    role: "user",
    status: "active",
    emailVerified: true,
    verificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    lastLogin: "2024-08-13T15:20:00.000Z",
    createdAt: "2024-06-01T12:00:00.000Z",
    updatedAt: "2024-08-13T15:20:00.000Z"
  }
];

/**
 * CATEGORIES Collection - Example Documents
 * Maps from PostgreSQL categories table
 */
const exampleCategories = [
  {
    _id: "507f191e810c19729de860ea",
    name: "Instagram",
    platformKey: "instagram", // immutable identifier
    icon: "instagram",
    status: "active",
    sortOrder: 1,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    _id: "507f191e810c19729de860eb",
    name: "TikTok",
    platformKey: "tiktok",
    icon: "tiktok",
    status: "active",
    sortOrder: 2,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    _id: "507f191e810c19729de860ec",
    name: "YouTube",
    platformKey: "youtube",
    icon: "youtube",
    status: "active",
    sortOrder: 3,
    createdAt: "2024-01-01T00:00:00.000Z"
  },
  {
    _id: "507f191e810c19729de860ed",
    name: "Twitter",
    platformKey: "twitter",
    icon: "twitter",
    status: "inactive",
    sortOrder: 4,
    createdAt: "2024-01-01T00:00:00.000Z"
  }
];

/**
 * SERVICES Collection - Example Documents
 * Maps from PostgreSQL services table
 * References categories by ObjectId
 */
const exampleServices = [
  {
    _id: "507f1f77bcf86cd799439020",
    categoryId: "507f191e810c19729de860ea", // Reference to Instagram category
    name: "Instagram Followers",
    description: "High-quality followers for your Instagram account",
    pricePer1000: "25.50", // Decimal128
    minQuantity: 100,
    maxQuantity: 50000,
    status: "active",
    createdAt: "2024-01-05T00:00:00.000Z",
    updatedAt: "2024-01-05T00:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439021",
    categoryId: "507f191e810c19729de860ea",
    name: "Instagram Likes",
    description: "Real likes from active users",
    pricePer1000: "15.00",
    minQuantity: 100,
    maxQuantity: 100000,
    status: "active",
    createdAt: "2024-01-05T00:00:00.000Z",
    updatedAt: "2024-01-05T00:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439022",
    categoryId: "507f191e810c19729de860eb",
    name: "TikTok Views",
    description: "Boost your TikTok video views instantly",
    pricePer1000: "8.00",
    minQuantity: 500,
    maxQuantity: 500000,
    status: "active",
    createdAt: "2024-01-05T00:00:00.000Z",
    updatedAt: "2024-01-05T00:00:00.000Z"
  }
];

/**
 * ORDERS Collection - Example Documents
 * Maps from PostgreSQL orders table
 * References users and services by ObjectId
 */
const exampleOrders = [
  {
    _id: "507f1f77bcf86cd799439030",
    userId: "507f1f77bcf86cd799439011", // Reference to John Doe
    serviceId: "507f1f77bcf86cd799439020", // Reference to Instagram Followers
    link: "https://instagram.com/john_doe",
    quantity: 1000,
    totalCost: "25.50", // 1000 / 1000 * 25.50 = 25.50
    status: "completed",
    startCount: 5000,
    remains: 0,
    adminNote: "Delivered successfully",
    createdAt: "2024-02-10T10:30:00.000Z",
    updatedAt: "2024-02-11T14:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439031",
    userId: "507f1f77bcf86cd799439011",
    serviceId: "507f1f77bcf86cd799439021",
    link: "https://instagram.com/p/ABC123",
    quantity: 500,
    totalCost: "7.50", // 500 / 1000 * 15.00 = 7.50
    status: "in_progress",
    startCount: 100,
    remains: 250,
    adminNote: null,
    createdAt: "2024-08-10T15:45:00.000Z",
    updatedAt: "2024-08-12T08:20:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439032",
    userId: "507f1f77bcf86cd799439013",
    serviceId: "507f1f77bcf86cd799439022",
    link: "https://www.tiktok.com/@user/video/123456789",
    quantity: 5000,
    totalCost: "40.00",
    status: "pending",
    startCount: null,
    remains: null,
    adminNote: null,
    createdAt: "2024-08-13T18:00:00.000Z",
    updatedAt: "2024-08-13T18:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439033",
    userId: "507f1f77bcf86cd799439011",
    serviceId: "507f1f77bcf86cd799439020",
    link: "https://instagram.com/test_account",
    quantity: 2000,
    totalCost: "51.00",
    status: "cancelled",
    startCount: null,
    remains: null,
    adminNote: "User requested cancellation",
    createdAt: "2024-07-20T09:30:00.000Z",
    updatedAt: "2024-07-21T11:00:00.000Z"
  }
];

/**
 * TRANSACTIONS Collection - Example Documents
 * Maps from PostgreSQL transactions table
 * References users by ObjectId
 */
const exampleTransactions = [
  {
    _id: "507f1f77bcf86cd799439040",
    userId: "507f1f77bcf86cd799439011",
    type: "credit",
    amount: "1000.00",
    description: "Razorpay payment received",
    razorpayPaymentId: "pay_2024081410300001",
    razorpayOrderId: "order_2024081410300001",
    paymentStatus: "success",
    createdAt: "2024-08-14T10:30:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439041",
    userId: "507f1f77bcf86cd799439011",
    type: "debit",
    amount: "25.50",
    description: "Order #507f1f77bcf86cd799439030 payment",
    razorpayPaymentId: null,
    razorpayOrderId: null,
    paymentStatus: "success",
    createdAt: "2024-02-10T10:30:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439042",
    userId: "507f1f77bcf86cd799439013",
    type: "credit",
    amount: "500.00",
    description: "Admin manual credit adjustment",
    razorpayPaymentId: null,
    razorpayOrderId: null,
    paymentStatus: "success",
    createdAt: "2024-08-01T15:20:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439043",
    userId: "507f1f77bcf86cd799439011",
    type: "credit",
    amount: "100.00",
    description: "Razorpay payment pending",
    razorpayPaymentId: "pay_2024081312000001",
    razorpayOrderId: "order_2024081312000001",
    paymentStatus: "pending",
    createdAt: "2024-08-13T12:00:00.000Z"
  }
];

/**
 * SUPPORT TICKETS Collection - Example Documents
 * Maps from PostgreSQL support_tickets + ticket_replies tables
 * NOTE: ticket_replies are EMBEDDED as an array within each ticket
 * This denormalization improves query performance
 */
const exampleSupportTickets = [
  {
    _id: "507f1f77bcf86cd799439050",
    userId: "507f1f77bcf86cd799439011",
    subject: "Order not completed",
    message: "I ordered 1000 followers but only received 500. Please help!",
    status: "replied",
    replies: [
      {
        _id: "507f1f77bcf86cd799439051",
        message: "We're looking into this. Can you provide your order ID?",
        isAdmin: true,
        createdAt: "2024-08-12T09:00:00.000Z"
      },
      {
        _id: "507f1f77bcf86cd799439052",
        message: "My order ID is 507f1f77bcf86cd799439030",
        isAdmin: false,
        createdAt: "2024-08-12T10:15:00.000Z"
      },
      {
        _id: "507f1f77bcf86cd799439053",
        message: "We've checked and sent the remaining 500. Check your account now.",
        isAdmin: true,
        createdAt: "2024-08-12T14:30:00.000Z"
      }
    ],
    createdAt: "2024-08-11T16:45:00.000Z",
    updatedAt: "2024-08-12T14:30:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439054",
    userId: "507f1f77bcf86cd799439013",
    subject: "Payment issues",
    message: "I'm unable to add funds to my account. Getting an error.",
    status: "open",
    replies: [],
    createdAt: "2024-08-14T08:00:00.000Z",
    updatedAt: "2024-08-14T08:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439055",
    userId: "507f1f77bcf86cd799439011",
    subject: "Refund request",
    message: "I want to cancel my recent order and get a refund.",
    status: "closed",
    replies: [
      {
        _id: "507f1f77bcf86cd799439056",
        message: "Refund has been processed to your account. Thank you!",
        isAdmin: true,
        createdAt: "2024-07-25T11:00:00.000Z"
      }
    ],
    createdAt: "2024-07-24T14:00:00.000Z",
    updatedAt: "2024-07-25T11:00:00.000Z"
  }
];

/**
 * RATE LIMIT BUCKETS Collection - Example Documents
 * Maps from PostgreSQL rate_limit_buckets table
 * Uses bucketKey as the _id for atomic operations
 * Includes TTL index for automatic cleanup
 */
const exampleRateLimitBuckets = [
  {
    _id: "ip:192.168.1.100:login",
    bucketKey: "ip:192.168.1.100:login",
    count: 3,
    resetAt: "2024-08-14T11:00:00.000Z"
  },
  {
    _id: "user:507f1f77bcf86cd799439011:api",
    bucketKey: "user:507f1f77bcf86cd799439011:api",
    count: 45,
    resetAt: "2024-08-15T00:00:00.000Z"
  },
  {
    _id: "ip:10.0.0.5:register",
    bucketKey: "ip:10.0.0.5:register",
    count: 1,
    resetAt: "2024-08-14T11:30:00.000Z"
  }
];

/**
 * SITE SETTINGS Collection - Example Document
 * Maps from PostgreSQL site_settings table
 * NOTE: This should typically be a singleton document (one record)
 * Razorpay credentials are stored in environment variables, NOT here
 */
const exampleSiteSettings = {
  _id: "507f1f77bcf86cd799439060",
  siteName: "Premium SMM Panel",
  siteLogo: "https://example.com/logo.png",
  minCreditAmount: "50.00",
  announcementText: "Server maintenance scheduled on Aug 20. We'll be down for 2 hours.",
  supportEmail: "support@smmpanel.com",
  maintenanceMode: false,
  updatedAt: "2024-08-14T08:00:00.000Z"
};

/**
 * ADMIN AUDIT LOGS Collection - Example Documents
 * Maps from PostgreSQL admin_audit_logs table
 * References admin users by ObjectId
 */
const exampleAdminAuditLogs = [
  {
    _id: "507f1f77bcf86cd799439070",
    adminId: "507f1f77bcf86cd799439012", // Reference to Admin User
    action: "user_blocked",
    targetType: "user",
    targetId: "507f1f77bcf86cd799439011",
    details: "User was spamming orders",
    createdAt: "2024-08-13T15:30:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439071",
    adminId: "507f1f77bcf86cd799439012",
    action: "service_status_changed",
    targetType: "service",
    targetId: "507f1f77bcf86cd799439020",
    details: '{"status": "inactive", "reason": "Provider rate limit"}',
    createdAt: "2024-08-12T10:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439072",
    adminId: "507f1f77bcf86cd799439012",
    action: "manual_credit_adjustment",
    targetType: "user",
    targetId: "507f1f77bcf86cd799439013",
    details: '{"amount": 500.00, "reason": "Promotional credit"}',
    createdAt: "2024-08-01T12:00:00.000Z"
  },
  {
    _id: "507f1f77bcf86cd799439073",
    adminId: "507f1f77bcf86cd799439012",
    action: "settings_updated",
    targetType: "settings",
    targetId: null,
    details: '{"minCreditAmount": "50.00", "maintenanceMode": false}',
    createdAt: "2024-08-14T08:00:00.000Z"
  }
];

// ============================================================================
// MIGRATION GUIDE & RELATIONSHIP MAPPING
// ============================================================================

const MIGRATION_NOTES = `
# PostgreSQL → MongoDB Migration Guide

## Collection Mapping

PostgreSQL Table → MongoDB Collection

1. users → users
2. categories → categories
3. services → services
4. orders → orders
5. transactions → transactions
6. support_tickets → supportTickets
   - ticket_replies → embedded in supportTickets.replies array
7. site_settings → siteSettings
8. rate_limit_buckets → rateLimitBuckets
9. admin_audit_logs → adminAuditLogs

## Key Changes from PostgreSQL

### 1. DECIMAL TYPES
   PostgreSQL: numeric(12, 2)
   MongoDB: Decimal128 (Mongoose Schema.Types.Decimal128)
   - Usage: Store monetary values as Decimal128, convert to string for calculations
   - Examples: creditBalance, pricePer1000, totalCost, amount, minCreditAmount

### 2. FOREIGN KEY RELATIONSHIPS
   PostgreSQL: Foreign key constraints at DB level
   MongoDB: Use ObjectId references with ref: 'ModelName' in schema
   
   - orders.userId → userId: ObjectId (ref: 'User')
   - orders.serviceId → serviceId: ObjectId (ref: 'Service')
   - services.categoryId → categoryId: ObjectId (ref: 'Category')
   - transactions.userId → userId: ObjectId (ref: 'User')
   - supportTickets.userId → userId: ObjectId (ref: 'User')
   - adminAuditLogs.adminId → adminId: ObjectId (ref: 'User')

### 3. CASCADE DELETE BEHAVIOR
   PostgreSQL: ON DELETE cascade at foreign key level
   MongoDB: Implement in application code using post-delete middleware
   
   Example:
   UserSchema.post('findByIdAndDelete', async (doc) => {
     if (doc) {
       await Order.deleteMany({ userId: doc._id });
       await Transaction.deleteMany({ userId: doc._id });
       // ... etc
     }
   });

### 4. PRIMARY KEYS
   PostgreSQL: serial INT PRIMARY KEY (auto-incrementing integer)
   MongoDB: ObjectId (default _id field, auto-generated)
   - No need to explicitly set; MongoDB handles it
   - ObjectIds are 12-byte unique identifiers

### 5. ENUMS
   PostgreSQL: CREATE TYPE enum (enforced at DB level)
   MongoDB: String field with enum validation
   
   Example:
   role: { type: String, enum: ['user', 'admin'] }

### 6. UNIQUE CONSTRAINTS
   PostgreSQL: UNIQUE INDEX on column
   MongoDB: Mongoose schema unique: true option
   
   users.email:
   - PostgreSQL: UNIQUE INDEX users_email_unique
   - MongoDB: email: { type: String, unique: true }

### 7. TIMESTAMPS
   PostgreSQL: timestamp with time zone DEFAULT now()
   MongoDB: Use Mongoose timestamps: true for automatic createdAt/updatedAt
   - Converts to ISO 8601 format in MongoDB

### 8. BOOLEAN FIELDS
   PostgreSQL: boolean
   MongoDB: Boolean type (direct mapping)

### 9. NULLABLE FIELDS
   PostgreSQL: NOT NULL constraint vs nullable
   MongoDB: Use { type: String, default: null } for optional fields

### 10. EMBEDDED DOCUMENTS (Denormalization)
   TicketReplies:
   - PostgreSQL: Separate table with foreign key
   - MongoDB: Embedded array in supportTickets document
   - Rationale: Tickets and replies are always queried together
   - Atomic updates: Update ticket + replies in single operation
   - Query performance: No join needed

## Indexing Strategy

All indexes from PostgreSQL preserved in MongoDB:

1. users: unique index on email
2. categories: index on platformKey (sparse), status
3. services: index on categoryId, status
4. orders: index on userId, serviceId, status, createdAt (compound)
5. transactions: index on userId, razorpayOrderId (sparse), createdAt
6. supportTickets: index on userId, status, createdAt
7. rateLimitBuckets: TTL index on resetAt (auto-cleanup)
8. adminAuditLogs: index on adminId, createdAt

## Query Examples (Mongoose)

### Find with Population (JOIN equivalent)
\`\`\`javascript
// Get order with user and service details
const order = await Order.findById(orderId)
  .populate('userId', 'name email')
  .populate('serviceId', 'name categoryId pricePer1000');
\`\`\`

### Embedded Array Query
\`\`\`javascript
// Find all tickets with replies from admins
const tickets = await SupportTicket.find({
  'replies.isAdmin': true
});
\`\`\`

### Aggregate with Lookup (JOIN)
\`\`\`javascript
// Get total spent by user
const result = await Order.aggregate([
  { $match: { userId: ObjectId(userId) } },
  { $group: { _id: null, total: { $sum: '$totalCost' } } }
]);
\`\`\`

## Data Type Mapping Reference

PostgreSQL Type     → MongoDB Type               → Mongoose Type
serial              → ObjectId (auto)            → Schema.Types.ObjectId
text                → String                     → String
integer             → Number                     → Number
boolean             → Boolean                    → Boolean
numeric(12, 2)      → Decimal128                 → Schema.Types.Decimal128
timestamp           → Date                       → Date
enum                → String (validated)         → { type: String, enum: [...] }

## Backend Logic Considerations

### NO CHANGES REQUIRED for:
- Authentication (bcrypt hashing still works)
- Password reset logic (tokens are just strings)
- Razorpay integration (payment IDs/orders work the same)
- Email verification (tokens unchanged)
- Rate limiting (bucket keys are the same)

### MINOR ADJUSTMENTS for:
- Joins: Use .populate() instead of SQL joins
- Decimal calculations: Convert Decimal128 to string/number for math
- Pagination: Use skip()/limit() instead of OFFSET/LIMIT
- Transactions: Use MongoDB sessions for multi-document ACID operations

## Migration Steps

1. Set up MongoDB connection in env vars
2. Replace Drizzle imports with Mongoose
3. Update database initialization in src/db/index.ts
4. Update API routes to use Mongoose methods
5. Add Mongoose middleware for cascade deletes
6. Test all queries against new schema
7. Migrate data from PostgreSQL (see separate migration script)
8. Update error handling (MongoDB errors differ from Postgres)

## No Frontend Changes Needed
- Field names are preserved (creditBalance, createdAt, etc.)
- Response formats remain the same
- API endpoints return same data structure
- UI components expect same field names
`;

// ============================================================================
// EXAMPLE INITIALIZATION CODE (src/db/mongodb-init.ts)
// ============================================================================

const MONGODB_INIT_EXAMPLE = `
import mongoose from 'mongoose';
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
} from './mongodb-schema';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smm-panel';

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      retryWrites: true,
      w: 'majority',
    });
    console.log('Connected to MongoDB');

    // Initialize singleton site settings document
    const settings = await SiteSettings.findOne();
    if (!settings) {
      await SiteSettings.create({
        siteName: 'SMM Panel',
        minCreditAmount: 50,
        announcementText: '',
        supportEmail: '',
        maintenanceMode: false,
      });
    }

    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
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
};
`;

// ============================================================================
// EXPORTS FOR DOCUMENTATION
// ============================================================================

export {
  exampleUsers,
  exampleCategories,
  exampleServices,
  exampleOrders,
  exampleTransactions,
  exampleSupportTickets,
  exampleRateLimitBuckets,
  exampleSiteSettings,
  exampleAdminAuditLogs,
  MIGRATION_NOTES,
  MONGODB_INIT_EXAMPLE,
};
