/**
 * MongoDB Query Patterns - Migration Guide
 * 
 * This file shows practical query examples for common operations,
 * with side-by-side PostgreSQL/Drizzle → MongoDB/Mongoose comparisons.
 * 
 * No backend logic changes required - only database queries adapt.
 */

// ============================================================================
// SETUP
// ============================================================================

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
  type OrderStatus,
} from '@/db/mongodb-schema';

// ============================================================================
// USER QUERIES
// ============================================================================

// 1. Find user by email
// PostgreSQL/Drizzle:
//   const user = await db.select().from(users).where(eq(users.email, email));
// MongoDB/Mongoose:
async function getUserByEmail(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  return user;
}

// 2. Create new user
// PostgreSQL/Drizzle:
//   const user = await db.insert(users).values({ name, email, password }).returning();
// MongoDB/Mongoose:
async function createUser(data: { name: string; email: string; password: string }) {
  const user = await User.create({
    name: data.name,
    email: data.email.toLowerCase(),
    password: data.password,
    creditBalance: 0,
    role: 'user' as const,
    status: 'active' as const,
  });
  return user;
}

// 3. Update user credit balance
// PostgreSQL/Drizzle:
//   const updated = await db.update(users)
//     .set({ creditBalance: sql`${users.creditBalance} + ${amount}` })
//     .where(eq(users.id, userId))
//     .returning();
// MongoDB/Mongoose:
async function addUserCredit(userId: string, amount: number) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  
  // Convert Decimal128 to number, add, then back to string
  const currentBalance = parseFloat(user.creditBalance.toString());
  const newBalance = (currentBalance + amount).toFixed(2);
  
  const updated = await User.findByIdAndUpdate(
    userId,
    { creditBalance: newBalance },
    { returnDocument: "after" }
  );
  return updated;
}

// 4. Verify user email
// PostgreSQL/Drizzle:
//   await db.update(users)
//     .set({ emailVerified: true, verificationToken: null })
//     .where(eq(users.verificationToken, token));
// MongoDB/Mongoose:
async function verifyUserEmail(verificationToken: string) {
  const updated = await User.findOneAndUpdate(
    { verificationToken },
    {
      emailVerified: true,
      verificationToken: null,
    },
    { returnDocument: "after" }
  );
  return updated;
}

// 5. Update password reset token
// PostgreSQL/Drizzle:
//   await db.update(users)
//     .set({ resetPasswordToken: token, resetPasswordExpires: expiresAt })
//     .where(eq(users.email, email));
// MongoDB/Mongoose:
async function setPasswordResetToken(email: string, token: string, expiresAt: Date) {
  const updated = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      resetPasswordToken: token,
      resetPasswordExpires: expiresAt,
    },
    { returnDocument: "after" }
  );
  return updated;
}

// 6. Get admin users
// PostgreSQL/Drizzle:
//   const admins = await db.select().from(users).where(eq(users.role, 'admin'));
// MongoDB/Mongoose:
async function getAdminUsers() {
  const admins = await User.find({ role: 'admin' as const });
  return admins;
}

// 7. Block/unblock user
// PostgreSQL/Drizzle:
//   await db.update(users).set({ status: 'blocked' }).where(eq(users.id, userId));
// MongoDB/Mongoose:
async function blockUser(userId: string) {
  const updated = await User.findByIdAndUpdate(
    userId,
    { status: 'blocked' },
    { returnDocument: "after" }
  );
  return updated;
}

// ============================================================================
// CATEGORY QUERIES
// ============================================================================

// 1. Get all active categories sorted by order
// PostgreSQL/Drizzle:
//   const categories = await db.select().from(categories)
//     .where(eq(categories.status, 'active'))
//     .orderBy(asc(categories.sortOrder));
// MongoDB/Mongoose:
async function getActiveCategories() {
  const categories = await Category.find({ status: 'active' as const })
    .sort({ sortOrder: 1 })
    .exec();
  return categories;
}

// 2. Get category by platform key
// PostgreSQL/Drizzle:
//   const category = await db.select().from(categories)
//     .where(eq(categories.platformKey, key)).limit(1);
// MongoDB/Mongoose:
async function getCategoryByPlatformKey(platformKey: string) {
  const category = await Category.findOne({ platformKey });
  return category;
}

// 3. Create category
// PostgreSQL/Drizzle:
//   const category = await db.insert(categories).values({ name, platformKey }).returning();
// MongoDB/Mongoose:
async function createCategory(data: { name: string; platformKey?: string; icon?: string }) {
  const category = await Category.create({
    name: data.name,
    platformKey: data.platformKey || null,
    icon: data.icon || null,
    status: 'active' as const,
    sortOrder: 0,
  });
  return category;
}

// 4. Update category sort order
// PostgreSQL/Drizzle:
//   await db.update(categories)
//     .set({ sortOrder: newOrder })
//     .where(eq(categories.id, categoryId));
// MongoDB/Mongoose:
async function updateCategorySortOrder(categoryId: string, sortOrder: number) {
  const updated = await Category.findByIdAndUpdate(
    categoryId,
    { sortOrder },
    { returnDocument: "after" }
  );
  return updated;
}

// ============================================================================
// SERVICE QUERIES
// ============================================================================

// 1. Get services by category
// PostgreSQL/Drizzle:
//   const services = await db.select().from(services)
//     .where(eq(services.categoryId, categoryId))
//     .where(eq(services.status, 'active'));
// MongoDB/Mongoose:
async function getServicesByCategory(categoryId: string) {
  const services = await Service.find({
    categoryId,
    status: 'active' as const,
  });
  return services;
}

// 2. Get service with category details (JOIN equivalent)
// PostgreSQL/Drizzle:
//   const service = await db.select().from(services)
//     .leftJoin(categories, eq(services.categoryId, categories.id))
//     .where(eq(services.id, serviceId));
// MongoDB/Mongoose:
async function getServiceWithCategory(serviceId: string) {
  const service = await Service.findById(serviceId).populate(
    'categoryId',
    'name platformKey icon'
  );
  return service;
}

// 3. Create service
// PostgreSQL/Drizzle:
//   const service = await db.insert(services)
//     .values({ categoryId, name, description, pricePer1000, minQuantity, maxQuantity })
//     .returning();
// MongoDB/Mongoose:
async function createService(data: {
  categoryId: string;
  name: string;
  description?: string;
  pricePer1000: string;
  minQuantity: number;
  maxQuantity: number;
}) {
  const service = await Service.create({
    categoryId: new mongoose.Types.ObjectId(data.categoryId),
    name: data.name,
    description: data.description || null,
    pricePer1000: Number(data.pricePer1000),
    minQuantity: data.minQuantity,
    maxQuantity: data.maxQuantity,
    status: 'active' as const,
  });
  return service;
}

// 4. Disable service
// PostgreSQL/Drizzle:
//   await db.update(services).set({ status: 'inactive' }).where(eq(services.id, serviceId));
// MongoDB/Mongoose:
async function disableService(serviceId: string) {
  const updated = await Service.findByIdAndUpdate(
    serviceId,
    { status: 'inactive' },
    { returnDocument: "after" }
  );
  return updated;
}

// ============================================================================
// ORDER QUERIES
// ============================================================================

// 1. Create order
// PostgreSQL/Drizzle:
//   const order = await db.insert(orders).values({ userId, serviceId, link, quantity, totalCost }).returning();
// MongoDB/Mongoose:
async function createOrder(data: {
  userId: string;
  serviceId: string;
  link: string;
  quantity: number;
  totalCost: string;
}) {
  const order = await Order.create({
    userId: new mongoose.Types.ObjectId(data.userId),
    serviceId: new mongoose.Types.ObjectId(data.serviceId),
    link: data.link,
    quantity: data.quantity,
    totalCost: Number(data.totalCost),
    status: 'pending' as const,
  });
  return order;
}

// 2. Get user orders with service details
// PostgreSQL/Drizzle:
//   const orders = await db.select().from(orders)
//     .where(eq(orders.userId, userId))
//     .orderBy(desc(orders.createdAt));
// MongoDB/Mongoose:
async function getUserOrders(userId: string, limit: number = 50) {
  const orders = await Order.find({ userId })
    .populate('serviceId', 'name categoryId pricePer1000')
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
  return orders;
}

// 3. Get order by ID with full details
// PostgreSQL/Drizzle:
//   const order = await db.select().from(orders)
//     .leftJoin(users, eq(orders.userId, users.id))
//     .leftJoin(services, eq(orders.serviceId, services.id))
//     .where(eq(orders.id, orderId));
// MongoDB/Mongoose:
async function getOrderWithDetails(orderId: string) {
  const order = await Order.findById(orderId)
    .populate('userId', 'name email creditBalance')
    .populate({
      path: 'serviceId',
      select: 'name categoryId pricePer1000',
      populate: { path: 'categoryId', select: 'name' },
    })
    .exec();
  return order;
}

// 4. Update order status
// PostgreSQL/Drizzle:
//   await db.update(orders).set({ status: 'completed', remains: 0 }).where(eq(orders.id, orderId));
// MongoDB/Mongoose:
async function updateOrderStatus(orderId: string, status: string, remains?: number) {
  const update: any = { status };
  if (remains !== undefined) update.remains = remains;

  const updated = await Order.findByIdAndUpdate(orderId, update, { returnDocument: "after" });
  return updated;
}

// 5. Get orders by status
// PostgreSQL/Drizzle:
//   const orders = await db.select().from(orders).where(eq(orders.status, status));
// MongoDB/Mongoose:
async function getOrdersByStatus(status: string, limit: number = 100) {
  const orders = await Order.find({ status: status as OrderStatus })
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
  return orders;
}

// 6. Get user's total spending
// PostgreSQL/Drizzle:
//   const result = await db.select({ total: sql`SUM(${orders.totalCost})` })
//     .from(orders)
//     .where(eq(orders.userId, userId));
// MongoDB/Mongoose:
async function getUserTotalSpending(userId: string) {
  const result = await Order.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, total: { $sum: '$totalCost' } } },
  ]);
  return result[0]?.total || 0;
}

// 7. Delete order (cascade)
// PostgreSQL/Drizzle:
//   await db.delete(orders).where(eq(orders.id, orderId));
// MongoDB/Mongoose:
async function deleteOrder(orderId: string) {
  // Delete order
  const deleted = await Order.findByIdAndDelete(orderId);
  
  // If you need to cascade or update related data:
  // await updateRelatedCollections(orderId);
  
  return deleted;
}

// ============================================================================
// TRANSACTION QUERIES
// ============================================================================

// 1. Create transaction
// PostgreSQL/Drizzle:
//   const transaction = await db.insert(transactions)
//     .values({ userId, type, amount, description, razorpayOrderId, paymentStatus })
//     .returning();
// MongoDB/Mongoose:
async function createTransaction(data: {
  userId: string;
  type: 'credit' | 'debit';
  amount: string;
  description?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
}) {
  const transaction = await Transaction.create({
    userId: new mongoose.Types.ObjectId(data.userId),
    type: data.type,
    amount: Number(data.amount),
    description: data.description || null,
    razorpayOrderId: data.razorpayOrderId || null,
    razorpayPaymentId: data.razorpayPaymentId || null,
    paymentStatus: 'pending' as const,
  });
  return transaction;
}

// 2. Get user transaction history
// PostgreSQL/Drizzle:
//   const transactions = await db.select().from(transactions)
//     .where(eq(transactions.userId, userId))
//     .orderBy(desc(transactions.createdAt));
// MongoDB/Mongoose:
async function getUserTransactions(userId: string, limit: number = 100) {
  const transactions = await Transaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
  return transactions;
}

// 3. Get transaction by Razorpay order ID
// PostgreSQL/Drizzle:
//   const transaction = await db.select().from(transactions)
//     .where(eq(transactions.razorpayOrderId, orderId)).limit(1);
// MongoDB/Mongoose:
async function getTransactionByRazorpayOrderId(razorpayOrderId: string) {
  const transaction = await Transaction.findOne({ razorpayOrderId });
  return transaction;
}

// 4. Update payment status
// PostgreSQL/Drizzle:
//   await db.update(transactions)
//     .set({ paymentStatus: 'success' })
//     .where(eq(transactions.razorpayOrderId, orderId));
// MongoDB/Mongoose:
async function updatePaymentStatus(transactionId: string, status: 'pending' | 'success' | 'failed') {
  const updated = await Transaction.findByIdAndUpdate(
    transactionId,
    { paymentStatus: status },
    { returnDocument: "after" }
  );
  return updated;
}

// ============================================================================
// SUPPORT TICKET QUERIES
// ============================================================================

// 1. Create support ticket
// PostgreSQL/Drizzle:
//   const ticket = await db.insert(supportTickets)
//     .values({ userId, subject, message })
//     .returning();
// MongoDB/Mongoose:
async function createSupportTicket(data: { userId: string; subject: string; message: string }) {
  const ticket = await SupportTicket.create({
    userId: new mongoose.Types.ObjectId(data.userId),
    subject: data.subject,
    message: data.message,
    status: 'open' as const,
    replies: [],
  });
  return ticket;
}

// 2. Get user's support tickets
// PostgreSQL/Drizzle:
//   const tickets = await db.select().from(supportTickets)
//     .where(eq(supportTickets.userId, userId))
//     .orderBy(desc(supportTickets.createdAt));
// MongoDB/Mongoose:
async function getUserSupportTickets(userId: string) {
  const tickets = await SupportTicket.find({ userId })
    .sort({ createdAt: -1 })
    .exec();
  return tickets;
}

// 3. Get all open tickets (for admin)
// PostgreSQL/Drizzle:
//   const tickets = await db.select().from(supportTickets)
//     .where(eq(supportTickets.status, 'open'))
//     .orderBy(asc(supportTickets.createdAt));
// MongoDB/Mongoose:
async function getOpenSupportTickets() {
  const tickets = await SupportTicket.find({ status: 'open' as const })
    .populate('userId', 'name email')
    .sort({ createdAt: 1 })
    .exec();
  return tickets;
}

// 4. Add reply to ticket (update array)
// PostgreSQL/Drizzle:
//   const reply = await db.insert(ticketReplies)
//     .values({ ticketId, message, isAdmin })
//     .returning();
// MongoDB/Mongoose:
async function addTicketReply(ticketId: string, message: string, isAdmin: boolean = false) {
  const reply = {
    _id: new mongoose.Types.ObjectId(),
    message,
    isAdmin,
    createdAt: new Date(),
  };

  const updated = await SupportTicket.findByIdAndUpdate(
    ticketId,
    {
      $push: { replies: reply },
      status: isAdmin ? 'replied' as const : 'replied' as const, // Mark as replied if admin responds
    },
    { returnDocument: "after" }
  );
  return updated;
}

// 5. Close support ticket
// PostgreSQL/Drizzle:
//   await db.update(supportTickets).set({ status: 'closed' }).where(eq(supportTickets.id, ticketId));
// MongoDB/Mongoose:
async function closeSupportTicket(ticketId: string) {
  const updated = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { status: 'closed' as const },
    { returnDocument: "after" }
  );
  return updated;
}

// 6. Get ticket with all replies
// PostgreSQL/Drizzle:
//   const ticket = await db.select().from(supportTickets)
//     .leftJoin(ticketReplies, eq(supportTickets.id, ticketReplies.ticketId))
//     .where(eq(supportTickets.id, ticketId));
// MongoDB/Mongoose:
async function getSupportTicketWithReplies(ticketId: string) {
  const ticket = await SupportTicket.findById(ticketId)
    .populate('userId', 'name email')
    .exec();
  return ticket; // replies are already embedded
}

// ============================================================================
// ADMIN & AUDIT QUERIES
// ============================================================================

// 1. Log admin action
// PostgreSQL/Drizzle:
//   await db.insert(adminAuditLogs)
//     .values({ adminId, action, targetType, targetId, details });
// MongoDB/Mongoose:
async function logAdminAction(data: {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: string;
}) {
  const log = await AdminAuditLog.create({
    adminId: new mongoose.Types.ObjectId(data.adminId),
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId || null,
    details: data.details || null,
  });
  return log;
}

// 2. Get admin audit logs
// PostgreSQL/Drizzle:
//   const logs = await db.select().from(adminAuditLogs)
//     .orderBy(desc(adminAuditLogs.createdAt))
//     .limit(100);
// MongoDB/Mongoose:
async function getAdminAuditLogs(limit: number = 100) {
  const logs = await AdminAuditLog.find()
    .populate('adminId', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
  return logs;
}

// 3. Get logs by admin
// PostgreSQL/Drizzle:
//   const logs = await db.select().from(adminAuditLogs)
//     .where(eq(adminAuditLogs.adminId, adminId));
// MongoDB/Mongoose:
async function getAdminLogs(adminId: string) {
  const logs = await AdminAuditLog.find({ adminId })
    .sort({ createdAt: -1 })
    .exec();
  return logs;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// 1. Increment rate limit bucket
// PostgreSQL/Drizzle:
//   await db.update(rateLimitBuckets)
//     .set({ count: sql`${rateLimitBuckets.count} + 1` })
//     .where(eq(rateLimitBuckets.bucketKey, key));
// MongoDB/Mongoose:
async function incrementRateLimitBucket(bucketKey: string, resetAt: Date) {
  const updated = await RateLimitBucket.findByIdAndUpdate(
    bucketKey,
    {
      $inc: { count: 1 },
      bucketKey,
      resetAt,
    },
    { returnDocument: "after", upsert: true }
  );
  return updated;
}

// 2. Check rate limit
// PostgreSQL/Drizzle:
//   const bucket = await db.select().from(rateLimitBuckets)
//     .where(eq(rateLimitBuckets.bucketKey, key));
// MongoDB/Mongoose:
async function checkRateLimit(bucketKey: string, limit: number) {
  const bucket = await RateLimitBucket.findById(bucketKey);

  if (!bucket || new Date() > bucket.resetAt) {
    return { allowed: true, remaining: limit };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: limit - bucket.count };
}

// ============================================================================
// SITE SETTINGS
// ============================================================================

// 1. Get site settings
// PostgreSQL/Drizzle:
//   const settings = await db.select().from(siteSettings).limit(1);
// MongoDB/Mongoose:
async function getSiteSettings() {
  // Singleton collection - should have exactly one document
  let settings = await SiteSettings.findOne();
  
  if (!settings) {
    // Create if doesn't exist
    settings = await SiteSettings.create({
      siteName: 'SMM Panel',
      minCreditAmount: 50,
      announcementText: '',
      maintenanceMode: false,
    });
  }
  
  return settings;
}

// 2. Update site settings
// PostgreSQL/Drizzle:
//   await db.update(siteSettings)
//     .set({ maintenanceMode: true, updatedAt: now() });
// MongoDB/Mongoose:
async function updateSiteSettings(updates: Partial<typeof SiteSettings>) {
  const settings = await SiteSettings.findOneAndUpdate(
    {}, // Empty filter to match singleton
    { ...updates, updatedAt: new Date() },
    { returnDocument: "after", upsert: true }
  );
  return settings;
}

// ============================================================================
// BULK OPERATIONS & TRANSACTIONS
// ============================================================================

// 1. Process pending orders in batch
// PostgreSQL/Drizzle:
//   const orders = await db.select().from(orders).where(eq(orders.status, 'pending'));
//   for (const order of orders) { ... }
// MongoDB/Mongoose:
async function processPendingOrders() {
  const orders = await Order.find({ status: 'pending' as const }).exec();

  for (const order of orders) {
    // Process order...
    await Order.findByIdAndUpdate(order._id, { status: 'processing' });
  }

  return orders.length;
}

// 2. Atomic transaction example (MongoDB Session)
// PostgreSQL/Drizzle:
//   BEGIN;
//   UPDATE users SET credit_balance = ... WHERE id = ...;
//   INSERT INTO transactions (...) VALUES (...);
//   COMMIT;
// MongoDB/Mongoose:
async function atomicCreditTransaction(userId: string, amount: string, orderId: string) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Deduct credit from user
    const user = await User.findByIdAndUpdate(
      userId,
      [{ $set: { creditBalance: { $subtract: [{ $toDecimal: '$creditBalance' }, amount] } } }],
      { returnDocument: "after", session }
    );

    // Record transaction
    const transaction = await Transaction.create(
      [
        {
          userId,
          type: 'debit' as const,
          amount: Number(amount),
          description: `Order #${orderId} payment`,
          paymentStatus: 'success' as const,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return { user, transaction };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // User queries
  getUserByEmail,
  createUser,
  addUserCredit,
  verifyUserEmail,
  setPasswordResetToken,
  getAdminUsers,
  blockUser,

  // Category queries
  getActiveCategories,
  getCategoryByPlatformKey,
  createCategory,
  updateCategorySortOrder,

  // Service queries
  getServicesByCategory,
  getServiceWithCategory,
  createService,
  disableService,

  // Order queries
  createOrder,
  getUserOrders,
  getOrderWithDetails,
  updateOrderStatus,
  getOrdersByStatus,
  getUserTotalSpending,
  deleteOrder,

  // Transaction queries
  createTransaction,
  getUserTransactions,
  getTransactionByRazorpayOrderId,
  updatePaymentStatus,

  // Support ticket queries
  createSupportTicket,
  getUserSupportTickets,
  getOpenSupportTickets,
  addTicketReply,
  closeSupportTicket,
  getSupportTicketWithReplies,

  // Admin queries
  logAdminAction,
  getAdminAuditLogs,
  getAdminLogs,

  // Rate limiting
  incrementRateLimitBucket,
  checkRateLimit,

  // Site settings
  getSiteSettings,
  updateSiteSettings,

  // Bulk operations
  processPendingOrders,
  atomicCreditTransaction,
};
