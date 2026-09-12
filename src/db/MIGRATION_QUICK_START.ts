/**
 * SMM Panel - MongoDB Conversion - Quick Start & Checklist
 * 
 * This file provides a step-by-step guide to implement the MongoDB migration.
 * Follow these steps sequentially to convert from PostgreSQL to MongoDB.
 */

// ============================================================================
// PHASE 1: SETUP & PREPARATION (Before Migration)
// ============================================================================

const PHASE_1_SETUP = `
# Phase 1: Setup & Preparation

## Prerequisites
- [ ] MongoDB server running (local or Atlas)
- [ ] Connection string ready (MONGODB_URI)
- [ ] Node.js and npm installed
- [ ] Project backup created
- [ ] All PostgreSQL data backed up

## Step 1.1: Install Dependencies
\`\`\`bash
npm install mongoose @types/mongoose
npm install --save-dev @types/node
\`\`\`

## Step 1.2: Add MongoDB Connection to .env
\`\`\`env
# .env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/smm-panel
# OR for local development:
MONGODB_URI=mongodb://localhost:27017/smm-panel
\`\`\`

## Step 1.3: Create MongoDB Connection Module
Create \`src/db/mongodb-init.ts\`:
\`\`\`typescript
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smm-panel';

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      retryWrites: true,
      w: 'majority',
    });
    console.log('✓ Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('✗ MongoDB connection error:', error);
    throw error;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
  console.log('✓ Disconnected from MongoDB');
}
\`\`\`

## Step 1.4: Update src/db/index.ts
Replace Drizzle exports with Mongoose models:

\`\`\`typescript
// OLD (Drizzle):
// import { db } from 'drizzle-orm/postgres-js';
// export * from './schema';

// NEW (Mongoose):
import { connectDB, disconnectDB } from './mongodb-init';
import * as models from './mongodb-schema';

export { connectDB, disconnectDB };
export { ...models };
\`\`\`

## Step 1.5: Verify Schema Files Present
Ensure these files exist in src/db/:
- [ ] mongodb-schema.ts (collection definitions)
- [ ] mongodb-examples.ts (example documents)
- [ ] mongodb-queries.ts (query functions)
- [ ] mongodb-init.ts (connection setup)
`;

// ============================================================================
// PHASE 2: DATA MIGRATION
// ============================================================================

const PHASE_2_DATA_MIGRATION = `
# Phase 2: Data Migration

## Option A: Using Node.js Script (Recommended)

Create \`scripts/migrate-postgres-to-mongodb.ts\`:

\`\`\`typescript
import pg from 'pg';
import mongoose from 'mongoose';
import { connectDB } from '../src/db/mongodb-init';
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
} from '../src/db/mongodb-schema';

const pgClient = new pg.Client(process.env.DATABASE_URL);

async function migrateData() {
  console.log('Starting migration...');

  // Connect to both databases
  await pgClient.connect();
  await connectDB();

  try {
    // 1. Migrate Users
    console.log('Migrating users...');
    const usersResult = await pgClient.query('SELECT * FROM users');
    const users = usersResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      name: row.name,
      email: row.email,
      password: row.password,
      googleId: row.google_id,
      avatar: row.avatar,
      creditBalance: row.credit_balance.toString(),
      role: row.role,
      status: row.status,
      emailVerified: row.email_verified,
      verificationToken: row.verification_token,
      resetPasswordToken: row.reset_password_token,
      resetPasswordExpires: row.reset_password_expires,
      lastLogin: row.last_login,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    // Store mapping of old IDs to new IDs
    const userIdMap = new Map();
    for (const user of users) {
      const oldId = usersResult.rows[users.indexOf(user)].id;
      userIdMap.set(oldId, user._id);
    }
    
    await User.insertMany(users);
    console.log(\`✓ Migrated \${users.length} users\`);

    // 2. Migrate Categories
    console.log('Migrating categories...');
    const categoriesResult = await pgClient.query('SELECT * FROM categories');
    const categories = categoriesResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      name: row.name,
      platformKey: row.platform_key,
      icon: row.icon,
      status: row.status,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    }));
    
    const categoryIdMap = new Map();
    for (const category of categories) {
      const oldId = categoriesResult.rows[categories.indexOf(category)].id;
      categoryIdMap.set(oldId, category._id);
    }
    
    await Category.insertMany(categories);
    console.log(\`✓ Migrated \${categories.length} categories\`);

    // 3. Migrate Services
    console.log('Migrating services...');
    const servicesResult = await pgClient.query('SELECT * FROM services');
    const services = servicesResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      categoryId: categoryIdMap.get(row.category_id),
      name: row.name,
      description: row.description,
      pricePer1000: row.price_per_1000.toString(),
      minQuantity: row.min_quantity,
      maxQuantity: row.max_quantity,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    const serviceIdMap = new Map();
    for (const service of services) {
      const oldId = servicesResult.rows[services.indexOf(service)].id;
      serviceIdMap.set(oldId, service._id);
    }
    
    await Service.insertMany(services);
    console.log(\`✓ Migrated \${services.length} services\`);

    // 4. Migrate Orders
    console.log('Migrating orders...');
    const ordersResult = await pgClient.query('SELECT * FROM orders');
    const orders = ordersResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      userId: userIdMap.get(row.user_id),
      serviceId: serviceIdMap.get(row.service_id),
      link: row.link,
      quantity: row.quantity,
      totalCost: row.total_cost.toString(),
      status: row.status,
      startCount: row.start_count,
      remains: row.remains,
      adminNote: row.admin_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    await Order.insertMany(orders);
    console.log(\`✓ Migrated \${orders.length} orders\`);

    // 5. Migrate Transactions
    console.log('Migrating transactions...');
    const transactionsResult = await pgClient.query('SELECT * FROM transactions');
    const transactions = transactionsResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      userId: userIdMap.get(row.user_id),
      type: row.type,
      amount: row.amount.toString(),
      description: row.description,
      razorpayPaymentId: row.razorpay_payment_id,
      razorpayOrderId: row.razorpay_order_id,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
    }));
    
    await Transaction.insertMany(transactions);
    console.log(\`✓ Migrated \${transactions.length} transactions\`);

    // 6. Migrate Support Tickets with Replies
    console.log('Migrating support tickets...');
    const ticketsResult = await pgClient.query('SELECT * FROM support_tickets');
    const repliesResult = await pgClient.query('SELECT * FROM ticket_replies');
    
    const tickets = ticketsResult.rows.map(row => {
      const ticketReplies = repliesResult.rows
        .filter(r => r.ticket_id === row.id)
        .map(r => ({
          _id: new mongoose.Types.ObjectId(),
          message: r.message,
          isAdmin: r.is_admin,
          createdAt: r.created_at,
        }));
      
      return {
        _id: new mongoose.Types.ObjectId(),
        userId: userIdMap.get(row.user_id),
        subject: row.subject,
        message: row.message,
        status: row.status,
        replies: ticketReplies,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    
    await SupportTicket.insertMany(tickets);
    console.log(\`✓ Migrated \${tickets.length} support tickets\`);

    // 7. Migrate Site Settings
    console.log('Migrating site settings...');
    const settingsResult = await pgClient.query('SELECT * FROM site_settings LIMIT 1');
    if (settingsResult.rows.length > 0) {
      const setting = settingsResult.rows[0];
      await SiteSettings.create({
        siteName: setting.site_name,
        siteLogo: setting.site_logo,
        minCreditAmount: setting.min_credit_amount.toString(),
        announcementText: setting.announcement_text,
        supportEmail: setting.support_email,
        maintenanceMode: setting.maintenance_mode,
        updatedAt: setting.updated_at,
      });
      console.log('✓ Migrated site settings');
    }

    // 8. Migrate Admin Audit Logs
    console.log('Migrating admin audit logs...');
    const logsResult = await pgClient.query('SELECT * FROM admin_audit_logs');
    const logs = logsResult.rows.map(row => ({
      _id: new mongoose.Types.ObjectId(),
      adminId: userIdMap.get(row.admin_id),
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
      createdAt: row.created_at,
    }));
    
    await AdminAuditLog.insertMany(logs);
    console.log(\`✓ Migrated \${logs.length} admin audit logs\`);

    console.log('\\n✓ Migration completed successfully!');
    console.log('\\nNext steps:');
    console.log('1. Update API routes to use Mongoose instead of Drizzle');
    console.log('2. Test all functionality against MongoDB');
    console.log('3. Update error handling for MongoDB');
    console.log('4. Deploy to production');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    await mongoose.disconnect();
  }
}

// Run migration
migrateData().then(() => process.exit(0));
\`\`\`

Run the migration:
\`\`\`bash
npx ts-node scripts/migrate-postgres-to-mongodb.ts
\`\`\`

## Option B: Manual Data Export/Import

### Export from PostgreSQL
\`\`\`bash
# Export each table as JSON
psql -U postgres -d smm_panel -c "SELECT * FROM users" -o users.json --json
psql -U postgres -d smm_panel -c "SELECT * FROM categories" -o categories.json --json
# ... etc for all tables
\`\`\`

### Import into MongoDB
\`\`\`bash
mongoimport --uri "mongodb+srv://user:pass@cluster.mongodb.net/smm-panel" \\
  --collection users \\
  --file users.json \\
  --jsonArray
\`\`\`

## Verification
After migration, verify all data:
\`\`\`javascript
// In MongoDB shell or Compass
db.users.countDocuments()         // Should match count from PostgreSQL
db.categories.countDocuments()    // Should match count
db.services.countDocuments()      // Should match count
db.orders.countDocuments()        // Should match count
db.transactions.countDocuments()  // Should match count
db.supportTickets.countDocuments() // Should match count
\`\`\`
`;

// ============================================================================
// PHASE 3: CODE UPDATES
// ============================================================================

const PHASE_3_CODE_UPDATES = `
# Phase 3: Code Updates

## Step 3.1: Update API Routes

All routes need to change from Drizzle to Mongoose. Example:

### OLD (PostgreSQL/Drizzle)
\`\`\`typescript
// src/app/api/auth/login/route.ts
import { db } from 'drizzle-orm/postgres-js';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  const { email, password } = await req.json();
  
  const user = await db.select().from(users)
    .where(eq(users.email, email));
  
  // ...
}
\`\`\`

### NEW (MongoDB/Mongoose)
\`\`\`typescript
// src/app/api/auth/login/route.ts
import { User } from '@/db/mongodb-schema';
import { getUserByEmail } from '@/db/mongodb-queries';

export async function POST(req: Request) {
  const { email, password } = await req.json();
  
  const user = await getUserByEmail(email);
  
  // ... rest is identical
}
\`\`\`

## Step 3.2: Update Imports

Search and replace:
- \`from 'drizzle-orm/postgres-js'\` → use Mongoose imports
- \`from '@/db/schema'\` → \`from '@/db/mongodb-schema'\`
- \`eq(...)\`, \`sql\`, etc. → use Mongoose query syntax

## Step 3.3: Add Mongoose Initialization

In your server startup (likely \`src/instrumentation.ts\` or main server file):

\`\`\`typescript
import { connectDB } from '@/db/mongodb-init';

// Call before starting server
await connectDB();
\`\`\`

## Step 3.4: Error Handling

Update error handling to account for MongoDB errors:

\`\`\`typescript
// MongoDB-specific error handling
try {
  const user = await User.findById(id);
} catch (error) {
  if (error instanceof mongoose.Error.CastError) {
    // Invalid ObjectId format
    return res.status(400).json({ error: 'Invalid ID' });
  }
  if (error instanceof mongoose.Error.ValidationError) {
    // Validation error
    return res.status(400).json({ error: error.message });
  }
  throw error;
}
\`\`\`

## Step 3.5: Transaction Handling

For operations requiring atomicity:

\`\`\`typescript
import { atomicCreditTransaction } from '@/db/mongodb-queries';

// Use helper function
const { user, transaction } = await atomicCreditTransaction(
  userId,
  amount,
  orderId
);
\`\`\`
`;

// ============================================================================
// PHASE 4: TESTING & DEPLOYMENT
// ============================================================================

const PHASE_4_TESTING = `
# Phase 4: Testing & Deployment

## Step 4.1: Unit Tests

Update your tests to use MongoDB test database:

\`\`\`typescript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

// jest.setup.ts
import { connectDB, disconnectDB } from '@/db/mongodb-init';

beforeAll(async () => {
  // Connect to test MongoDB
  process.env.MONGODB_URI = 'mongodb://localhost:27017/smm-panel-test';
  await connectDB();
});

afterAll(async () => {
  await disconnectDB();
});
\`\`\`

## Step 4.2: Test Each Feature

### Authentication
- [ ] Login with email/password
- [ ] Login with Google OAuth
- [ ] Email verification
- [ ] Password reset
- [ ] Token refresh

### Orders
- [ ] Create order
- [ ] Update order status
- [ ] Get user orders
- [ ] Calculate total spending

### Transactions
- [ ] Create credit transaction
- [ ] Create debit transaction
- [ ] Get transaction history
- [ ] Razorpay webhook handling

### Support Tickets
- [ ] Create ticket
- [ ] Add reply
- [ ] Close ticket
- [ ] Get ticket history

### Admin Features
- [ ] Block/unblock user
- [ ] Update service status
- [ ] View audit logs
- [ ] Update settings

## Step 4.3: Performance Testing

Verify indexes are working:

\`\`\`bash
# Check index usage
db.users.aggregate([{ $indexStats: {} }])
db.orders.aggregate([{ $indexStats: {} }])
\`\`\`

## Step 4.4: Staging Deployment

1. Set up MongoDB instance in staging environment
2. Deploy updated code to staging
3. Run full feature testing
4. Monitor logs for errors
5. Load test with expected production traffic

## Step 4.5: Production Deployment

### Pre-deployment
- [ ] Full backup of MongoDB
- [ ] All tests passing
- [ ] Load testing completed
- [ ] Team review completed
- [ ] Rollback plan prepared

### Deployment
- [ ] Update production .env with MongoDB connection
- [ ] Deploy application code
- [ ] Monitor error logs
- [ ] Verify all features working
- [ ] Monitor performance metrics

### Post-deployment
- [ ] Keep PostgreSQL running for fallback (optional)
- [ ] Monitor MongoDB connections
- [ ] Check application logs
- [ ] Monitor user reports
- [ ] After 24-48 hours, decommission PostgreSQL (if no rollback needed)
`;

// ============================================================================
// ROLLBACK PLAN
// ============================================================================

const ROLLBACK_PLAN = `
# Rollback Plan

## If Issues Arise

### Option 1: Quick Rollback (Keep both systems)

1. Keep PostgreSQL running during transition
2. If MongoDB has issues, revert to PostgreSQL
3. Switch DNS/routing back to PostgreSQL version

### Option 2: Data Resync

If MongoDB data becomes corrupted:

1. Stop application
2. Clear MongoDB collections
3. Re-run migration script
4. Restart application

### Option 3: Full Rollback to PostgreSQL

If major issues found:

1. Revert to previous application version
2. Update .env to use PostgreSQL
3. Restart application
4. Investigate issues with MongoDB

## Monitoring After Deployment

Monitor these metrics:
- [ ] Application error rate
- [ ] Database query performance
- [ ] MongoDB connection count
- [ ] Disk usage
- [ ] Memory usage
- [ ] User-reported issues
`;

// ============================================================================
// QUICK REFERENCE
// ============================================================================

const QUICK_REFERENCE = `
# Quick Reference Card

## Common Tasks

### Find and Update User
\`\`\`typescript
const user = await User.findByIdAndUpdate(
  userId,
  { creditBalance: newBalance },
  { returnDocument: "after" }
);
\`\`\`

### Create Order with Service Details
\`\`\`typescript
const order = await Order.create({
  userId: new ObjectId(userId),
  serviceId: new ObjectId(serviceId),
  link: 'https://...',
  quantity: 1000,
  totalCost: '25.50'
});
\`\`\`

### Query with Population (JOIN)
\`\`\`typescript
const orders = await Order.find({ userId })
  .populate('serviceId', 'name pricePer1000')
  .sort({ createdAt: -1 });
\`\`\`

### Embedded Document Operations
\`\`\`typescript
// Add reply to ticket
await SupportTicket.findByIdAndUpdate(
  ticketId,
  { $push: { replies: newReply } }
);

// Find tickets with admin replies
const tickets = await SupportTicket.find({
  'replies.isAdmin': true
});
\`\`\`

## Connection String Examples

### Local Development
\`mongodb://localhost:27017/smm-panel\`

### MongoDB Atlas
\`mongodb+srv://username:password@cluster.mongodb.net/smm-panel?retryWrites=true&w=majority\`

### Docker Container
\`mongodb://mongo:27017/smm-panel\`

## Useful MongoDB Commands

\`\`\`bash
# Show all collections
db.getCollectionNames()

# Count documents
db.users.countDocuments()

# Drop collection
db.orders.drop()

# View indexes
db.users.getIndexes()

# Run aggregation
db.orders.aggregate([...])
\`\`\`

## Decimal128 Handling

\`\`\`typescript
// Creating with Decimal128
{ creditBalance: Decimal128.fromString('123.45') }

// Reading Decimal128
const balance = doc.creditBalance.toString(); // Returns '123.45'

// Math with Decimal128
const newBalance = parseFloat(doc.creditBalance.toString()) + amount;
\`\`\`
`;

// ============================================================================
// EXPORTS
// ============================================================================

export {
  PHASE_1_SETUP,
  PHASE_2_DATA_MIGRATION,
  PHASE_3_CODE_UPDATES,
  PHASE_4_TESTING,
  ROLLBACK_PLAN,
  QUICK_REFERENCE,
};

// Print guide to console
console.log('='.repeat(80));
console.log('SMM PANEL - PostgreSQL to MongoDB Migration Guide');
console.log('='.repeat(80));
console.log('\nGenerated Files:');
console.log('  1. src/db/mongodb-schema.ts       - Mongoose schema definitions');
console.log('  2. src/db/mongodb-examples.ts     - Example documents');
console.log('  3. src/db/mongodb-queries.ts      - Query functions');
console.log('  4. MONGODB_MIGRATION.md           - Complete migration reference');
console.log('  5. src/db/MIGRATION_QUICK_START.ts - This file (implementation guide)');
console.log('\nImplementation Phases:');
console.log('  Phase 1: Setup & Preparation');
console.log('  Phase 2: Data Migration');
console.log('  Phase 3: Code Updates');
console.log('  Phase 4: Testing & Deployment');
console.log('\n' + '='.repeat(80));
