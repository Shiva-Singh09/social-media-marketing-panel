# PostgreSQL to MongoDB Migration Guide
## SMM Panel Project

**Date:** August 14, 2024  
**Status:** Schema Conversion Complete  
**Scope:** Database layer only - No backend/frontend logic changes

---

## Overview

This guide provides the complete MongoDB schema conversion for your SMM Panel project that currently uses PostgreSQL with Drizzle ORM. All tables have been converted to MongoDB collections with the following approach:

- ✅ **Field names preserved** - Same names as PostgreSQL columns
- ✅ **Data types mapped** - PostgreSQL types → MongoDB equivalents
- ✅ **Relationships maintained** - Foreign keys → ObjectId references
- ✅ **Enums enforced** - PostgreSQL enums → Mongoose validation
- ✅ **Indexes preserved** - All database indexes implemented
- ✅ **No logic changes** - Backend and frontend remain unchanged

---

## Collection Reference

### 1. Users Collection

**PostgreSQL:** `users` table  
**MongoDB:** `users` collection

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| name | text NOT NULL | String | Required |
| email | text UNIQUE | String, unique: true | Required, unique index |
| password | text | String, nullable | Optional, bcrypt hash |
| googleId | text | String, nullable | Optional, for Google OAuth |
| avatar | text | String, nullable | Optional, URL |
| creditBalance | numeric(12,2) | Decimal128 | Convert to string for calculations |
| role | enum (user\|admin) | String, enum | user \| admin |
| status | enum (active\|blocked) | String, enum | active \| blocked |
| emailVerified | boolean | Boolean | Default: false |
| verificationToken | text | String, nullable | Email verification token |
| resetPasswordToken | text | String, nullable | Password reset token |
| resetPasswordExpires | timestamp | Date, nullable | Token expiration |
| lastLogin | timestamp | Date, nullable | Timestamp of last login |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |
| updatedAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
// Unique email index
{ email: 1 }, { unique: true }

// Sparse googleId index
{ googleId: 1 }, { sparse: true }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  name: "John Doe",
  email: "john@example.com",
  password: "$2b$10$...",
  creditBalance: Decimal128("1500.50"),
  role: "user",
  status: "active",
  emailVerified: true,
  lastLogin: ISODate("2024-08-14T10:30:00Z"),
  createdAt: ISODate("2024-01-15T08:00:00Z"),
  updatedAt: ISODate("2024-08-14T10:30:00Z")
}
```

---

### 2. Categories Collection

**PostgreSQL:** `categories` table  
**MongoDB:** `categories` collection

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| name | text NOT NULL | String | Required, display name |
| platformKey | text | String, nullable | Immutable slug (instagram, tiktok) |
| icon | text | String, nullable | Icon name/URL |
| status | enum (active\|inactive) | String, enum | active \| inactive |
| sortOrder | integer | Number | Display order, default 0 |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
{ platformKey: 1 }, { sparse: true }
{ status: 1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f191e810c19729de860ea"),
  name: "Instagram",
  platformKey: "instagram",
  icon: "instagram",
  status: "active",
  sortOrder: 1,
  createdAt: ISODate("2024-01-01T00:00:00Z")
}
```

---

### 3. Services Collection

**PostgreSQL:** `services` table  
**MongoDB:** `services` collection

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| categoryId | integer FK | ObjectId, ref: 'Category' | Reference to Categories |
| name | text NOT NULL | String | Required |
| description | text | String, nullable | Optional |
| pricePer1000 | numeric(12,2) | Decimal128 | Price per 1000 units |
| minQuantity | integer | Number | Minimum order quantity |
| maxQuantity | integer | Number | Maximum order quantity |
| status | enum (active\|inactive) | String, enum | active \| inactive |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
{ categoryId: 1 }
{ status: 1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439020"),
  categoryId: ObjectId("507f191e810c19729de860ea"),
  name: "Instagram Followers",
  description: "High-quality followers",
  pricePer1000: Decimal128("25.50"),
  minQuantity: 100,
  maxQuantity: 50000,
  status: "active",
  createdAt: ISODate("2024-01-05T00:00:00Z"),
  updatedAt: ISODate("2024-01-05T00:00:00Z")
}
```

---

### 4. Orders Collection

**PostgreSQL:** `orders` table  
**MongoDB:** `orders` collection

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| userId | integer FK | ObjectId, ref: 'User' | Reference to Users |
| serviceId | integer FK | ObjectId, ref: 'Service' | Reference to Services |
| link | text NOT NULL | String | Social media link |
| quantity | integer NOT NULL | Number | Number of units |
| totalCost | numeric(12,2) | Decimal128 | Total cost |
| status | enum | String, enum | pending, processing, in_progress, completed, partial, cancelled, failed |
| startCount | integer | Number, nullable | Starting count before service |
| remains | integer | Number, nullable | Remaining count to deliver |
| adminNote | text | String, nullable | Admin notes |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |
| updatedAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
{ userId: 1 }
{ serviceId: 1 }
{ status: 1 }
{ createdAt: -1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439030"),
  userId: ObjectId("507f1f77bcf86cd799439011"),
  serviceId: ObjectId("507f1f77bcf86cd799439020"),
  link: "https://instagram.com/john_doe",
  quantity: 1000,
  totalCost: Decimal128("25.50"),
  status: "completed",
  startCount: 5000,
  remains: 0,
  adminNote: "Delivered successfully",
  createdAt: ISODate("2024-02-10T10:30:00Z"),
  updatedAt: ISODate("2024-02-11T14:00:00Z")
}
```

---

### 5. Transactions Collection

**PostgreSQL:** `transactions` table  
**MongoDB:** `transactions` collection

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| userId | integer FK | ObjectId, ref: 'User' | Reference to Users |
| type | enum (credit\|debit) | String, enum | credit \| debit |
| amount | numeric(12,2) | Decimal128 | Transaction amount |
| description | text | String, nullable | Description |
| razorpayPaymentId | text | String, nullable | Razorpay payment ID |
| razorpayOrderId | text | String, nullable | Razorpay order ID |
| paymentStatus | enum | String, enum | pending, success, failed |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
{ userId: 1 }
{ razorpayOrderId: 1 }, { sparse: true }
{ createdAt: -1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439040"),
  userId: ObjectId("507f1f77bcf86cd799439011"),
  type: "credit",
  amount: Decimal128("1000.00"),
  description: "Razorpay payment received",
  razorpayPaymentId: "pay_2024081410300001",
  razorpayOrderId: "order_2024081410300001",
  paymentStatus: "success",
  createdAt: ISODate("2024-08-14T10:30:00Z")
}
```

---

### 6. Support Tickets Collection

**PostgreSQL:** `support_tickets` table + `ticket_replies` table  
**MongoDB:** `supportTickets` collection with embedded `replies` array

**Key Difference:** In PostgreSQL, `ticket_replies` is a separate table with a foreign key. In MongoDB, replies are **embedded as a subdocument array** for better query performance and atomic updates.

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| userId | integer FK | ObjectId, ref: 'User' | Reference to Users |
| subject | text NOT NULL | String | Ticket subject |
| message | text NOT NULL | String | Initial message |
| status | enum | String, enum | open, replied, closed |
| replies | (separate table) | Array of subdocuments | **Embedded** array |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |
| updatedAt | timestamp | Date (auto) | Mongoose timestamps |

**Ticket Reply Subdocument:**

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| ticketId | integer FK | (parent ticket) | Implicit in parent |
| message | text NOT NULL | String | Reply message |
| isAdmin | boolean | Boolean | Is from admin |
| createdAt | timestamp | Date (auto) | Auto-generated |

**Indexes:**
```javascript
{ userId: 1 }
{ status: 1 }
{ createdAt: -1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439050"),
  userId: ObjectId("507f1f77bcf86cd799439011"),
  subject: "Order not completed",
  message: "I ordered 1000 followers but only received 500. Please help!",
  status: "replied",
  replies: [
    {
      _id: ObjectId("507f1f77bcf86cd799439051"),
      message: "We're looking into this. Can you provide your order ID?",
      isAdmin: true,
      createdAt: ISODate("2024-08-12T09:00:00Z")
    },
    {
      _id: ObjectId("507f1f77bcf86cd799439052"),
      message: "My order ID is 507f1f77bcf86cd799439030",
      isAdmin: false,
      createdAt: ISODate("2024-08-12T10:15:00Z")
    }
  ],
  createdAt: ISODate("2024-08-11T16:45:00Z"),
  updatedAt: ISODate("2024-08-12T14:30:00Z")
}
```

---

### 7. Rate Limit Buckets Collection

**PostgreSQL:** `rate_limit_buckets` table  
**MongoDB:** `rateLimitBuckets` collection

Used for rate limiting across multiple server instances.

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| bucketKey | text PK | String (_id) | Primary key as string |
| count | integer | Number | Current count |
| resetAt | timestamp | Date | TTL index for auto-cleanup |

**Indexes:**
```javascript
{ resetAt: 1 }, { expireAfterSeconds: 0 }  // TTL index
```

**Example:**
```javascript
{
  _id: "ip:192.168.1.100:login",
  bucketKey: "ip:192.168.1.100:login",
  count: 3,
  resetAt: ISODate("2024-08-14T11:00:00Z")
}
```

---

### 8. Site Settings Collection

**PostgreSQL:** `site_settings` table  
**MongoDB:** `siteSettings` collection

Singleton collection containing global site configuration.

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| siteName | text | String | Site name |
| siteLogo | text | String, nullable | Logo URL |
| minCreditAmount | numeric(12,2) | Decimal128 | Minimum credit to add |
| announcementText | text | String | Announcement banner |
| supportEmail | text | String, nullable | Support email |
| maintenanceMode | boolean | Boolean | Maintenance flag |
| updatedAt | timestamp | Date | Last update |

**Note:** Razorpay credentials are NOT stored here. They live in environment variables only.

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439060"),
  siteName: "Premium SMM Panel",
  siteLogo: "https://example.com/logo.png",
  minCreditAmount: Decimal128("50.00"),
  announcementText: "Maintenance scheduled Aug 20",
  supportEmail: "support@smmpanel.com",
  maintenanceMode: false,
  updatedAt: ISODate("2024-08-14T08:00:00Z")
}
```

---

### 9. Admin Audit Logs Collection

**PostgreSQL:** `admin_audit_logs` table  
**MongoDB:** `adminAuditLogs` collection

Tracks administrative actions for compliance and debugging.

| Field | PostgreSQL | MongoDB | Notes |
|-------|------------|---------|-------|
| id | serial PK | ObjectId (_id) | Auto-generated |
| adminId | integer FK | ObjectId, ref: 'User' | Reference to admin User |
| action | text NOT NULL | String | Action type |
| targetType | text NOT NULL | String | Type of target (user, service, etc.) |
| targetId | text | String, nullable | ID of target |
| details | text | String, nullable | JSON details |
| createdAt | timestamp | Date (auto) | Mongoose timestamps |

**Indexes:**
```javascript
{ adminId: 1 }
{ createdAt: -1 }
```

**Example:**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439070"),
  adminId: ObjectId("507f1f77bcf86cd799439012"),
  action: "user_blocked",
  targetType: "user",
  targetId: "507f1f77bcf86cd799439011",
  details: "User was spamming orders",
  createdAt: ISODate("2024-08-13T15:30:00Z")
}
```

---

## Data Type Mapping Reference

| PostgreSQL Type | MongoDB Type | Mongoose Type | Example |
|---|---|---|---|
| serial (primary key) | ObjectId | Schema.Types.ObjectId | auto-generated |
| text | String | String | "John Doe" |
| integer | Number | Number | 1000 |
| boolean | Boolean | Boolean | true/false |
| numeric(12, 2) | Decimal128 | Schema.Types.Decimal128 | "25.50" |
| timestamp | Date | Date | ISODate("2024-08-14T10:30:00Z") |
| enum('a'\|'b') | String | { type: String, enum: [...] } | "active" |

---

## Relationship Mapping

### Foreign Keys → ObjectId References

**PostgreSQL Model:**
```sql
CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  service_id integer REFERENCES services(id) ON DELETE RESTRICT
);
```

**MongoDB Mongoose Model:**
```javascript
const orderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true }
});

// Usage: populate to fetch related documents
const order = await Order.findById(id)
  .populate('userId', 'name email')
  .populate('serviceId', 'name pricePer1000');
```

### Cascade Delete Implementation

**PostgreSQL:** Handled by database constraints
**MongoDB:** Must be implemented in application code

```javascript
// Example: Delete user and cascade to related collections
UserSchema.post('findByIdAndDelete', async (doc) => {
  if (doc) {
    await Order.deleteMany({ userId: doc._id });
    await Transaction.deleteMany({ userId: doc._id });
    await SupportTicket.deleteMany({ userId: doc._id });
    await AdminAuditLog.deleteMany({ adminId: doc._id });
  }
});
```

### Embedded Documents

**Ticket Replies (Embedded in Tickets):**

```javascript
// PostgreSQL: Two separate tables joined by foreign key
SELECT * FROM support_tickets t
LEFT JOIN ticket_replies r ON t.id = r.ticket_id
WHERE t.id = 123;

// MongoDB: Single document with embedded array
db.supportTickets.findOne({ _id: ObjectId("...") });
// Returns document with replies array
```

---

## Indexing Strategy

All indexes from PostgreSQL have been preserved in MongoDB for performance.

### Index Summary

```javascript
// Users
{ email: 1 }, { unique: true }
{ googleId: 1 }, { sparse: true }

// Categories
{ platformKey: 1 }, { sparse: true }
{ status: 1 }

// Services
{ categoryId: 1 }
{ status: 1 }

// Orders
{ userId: 1 }
{ serviceId: 1 }
{ status: 1 }
{ createdAt: -1 }

// Transactions
{ userId: 1 }
{ razorpayOrderId: 1 }, { sparse: true }
{ createdAt: -1 }

// Support Tickets
{ userId: 1 }
{ status: 1 }
{ createdAt: -1 }

// Rate Limit Buckets
{ resetAt: 1 }, { expireAfterSeconds: 0 }  // TTL index

// Admin Audit Logs
{ adminId: 1 }
{ createdAt: -1 }
```

---

## What Stays the Same (No Backend Changes)

✅ **Authentication Logic**
- bcryptjs hashing works identically
- JWT tokens unchanged
- Password reset tokens are just strings

✅ **Razorpay Integration**
- Payment IDs work the same way
- Order IDs are strings in both systems
- Webhook processing unchanged

✅ **Email Verification**
- Verification tokens are just strings
- Same token generation logic

✅ **Rate Limiting**
- Bucket keys (strings) work identically
- Rate limit logic unchanged

✅ **Validation**
- Enum values are identical
- Zod validators can remain unchanged

✅ **Field Names**
- All MongoDB field names match PostgreSQL columns
- API response format identical
- Frontend requires NO changes

---

## What Changes (Minimal Adjustments)

⚠️ **Database Connection**
```javascript
// Old: PostgreSQL with Drizzle
import { db } from "drizzle-orm/postgres-js";

// New: MongoDB with Mongoose
import mongoose from "mongoose";
```

⚠️ **Joins → Populate**
```javascript
// Old: SQL JOIN
const order = await db.select().from(orders)
  .leftJoin(users, eq(orders.userId, users.id));

// New: Mongoose populate
const order = await Order.findById(id).populate('userId');
```

⚠️ **Decimal Calculations**
```javascript
// Old: SQL handles decimal arithmetic
SELECT credit_balance + amount AS new_balance FROM users;

// New: Convert Decimal128 to string/number
const newBalance = parseFloat(user.creditBalance) + amount;
```

⚠️ **Pagination**
```javascript
// Old: SQL OFFSET/LIMIT
SELECT * FROM orders OFFSET 10 LIMIT 20;

// New: Mongoose skip/limit
Orders.find().skip(10).limit(20);
```

⚠️ **Transactions (Multi-document)**
```javascript
// Old: Database transactions
BEGIN; ... COMMIT;

// New: MongoDB sessions
const session = await mongoose.startSession();
session.startTransaction();
// ... operations ...
await session.commitTransaction();
```

---

## Files Generated

1. **mongodb-schema.ts**
   - Mongoose schema definitions
   - TypeScript interfaces
   - All collections with proper indexing
   - Enum definitions

2. **mongodb-examples.ts**
   - Example documents for all collections
   - Sample insert statements
   - Migration notes
   - Initialization code template

3. **MIGRATION.md** (this file)
   - Complete reference guide
   - Collection mappings
   - Data type conversions
   - Query patterns

---

## Migration Checklist

- [ ] Set up MongoDB server/connection (local or Atlas)
- [ ] Install Mongoose: `npm install mongoose @types/mongoose`
- [ ] Update `.env` with MONGODB_URI
- [ ] Copy `mongodb-schema.ts` to `src/db/`
- [ ] Update `src/db/index.ts` to export Mongoose models
- [ ] Migrate data from PostgreSQL (use migration script)
- [ ] Update all API routes to use Mongoose methods
- [ ] Add Mongoose middleware for cascade deletes
- [ ] Test all queries and relationships
- [ ] Update error handling (MongoDB errors differ)
- [ ] Remove Drizzle dependencies: `npm uninstall drizzle-orm drizzle-kit`
- [ ] Test all features thoroughly
- [ ] Deploy to production

---

## Quick Query Reference

### Find Documents
```javascript
// Find one
const user = await User.findById(userId);

// Find many
const orders = await Order.find({ userId });

// With population (JOIN)
const order = await Order.findById(id)
  .populate('userId')
  .populate('serviceId');

// With filtering and pagination
const orders = await Order.find({ status: 'completed' })
  .skip(10)
  .limit(20)
  .sort({ createdAt: -1 });
```

### Create Documents
```javascript
// Single document
const user = await User.create({
  name: "John",
  email: "john@example.com",
  // ...
});

// Bulk create
await Order.insertMany([order1, order2, order3]);
```

### Update Documents
```javascript
// Update one
await User.findByIdAndUpdate(userId, {
  creditBalance: newBalance,
  lastLogin: new Date()
});

// Update many
await Order.updateMany(
  { status: 'pending' },
  { status: 'processing' }
);

// Update array element (in replies)
await SupportTicket.findByIdAndUpdate(
  ticketId,
  { $push: { replies: newReply } }
);
```

### Delete Documents
```javascript
// Delete one
await User.findByIdAndDelete(userId);

// Delete many
await Order.deleteMany({ status: 'cancelled' });
```

### Aggregation
```javascript
// Sum total spent by user
const result = await Order.aggregate([
  { $match: { userId: ObjectId(userId) } },
  { $group: { _id: null, total: { $sum: '$totalCost' } } }
]);

// Count by status
const statuses = await Order.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } }
]);
```

---

## Support & Resources

- **Mongoose Documentation:** https://mongoosejs.com/
- **MongoDB Documentation:** https://docs.mongodb.com/
- **MongoDB Decimal128:** https://docs.mongodb.com/manual/reference/method/Decimal128/
- **Schema Validation:** Mongoose handles at application level

---

**Generated:** August 14, 2024  
**Version:** 1.0  
**Status:** Ready for Implementation
