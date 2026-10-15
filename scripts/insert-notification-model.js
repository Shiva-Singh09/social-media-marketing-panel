const fs = require('fs');
const path = require('path');
const p = path.resolve('src/db/mongodb-schema.ts');
let text = fs.readFileSync(p, 'utf8');
const marker = "export const AdminAuditLog = (mongoose.models.AdminAuditLog as mongoose.Model<IAdminAuditLog>) || mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);";
if (!text.includes(marker)) {
  console.error('ERROR: marker not found');
  process.exit(1);
}
const insert = '\n\n// ==============================================================================\n// ADMIN NOTIFICATIONS\n// Operational/event notifications for admin observability (Phase 2C-6).\n// ==============================================================================\n\n/** Deterministic event categories for admin notifications. */\nexport const NotificationEventType = {\n  OrderPermanentFailure: "order.permanentFailure",\n  OrderNeedsReview: "order.needsReview",\n  OrderMaxRetries: "order.maxRetries",\n  OrderAmbiguousResult: "order.ambiguousResult",\n  OrderPollingFailed: "order.pollingFailed",\n  PaymentFailure: "payment.failure",\n  WorkerFailure: "worker.failure",\n} as const;\nexport type NotificationEventType = (typeof NotificationEventType)[keyof typeof NotificationEventType];\n\n/** Severity levels for triage prioritisation. */\nexport const NotificationSeverity = {\n  Info: "info",\n  Warning: "warning",\n  Critical: "critical",\n} as const;\nexport type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];\n\n/** Metadata fields that are safe to store for diagnostics. No secrets. */\nexport type NotificationMetadata = {\n  smmProviderKind?: string;\n  smmProviderCode?: number | string;\n  smmProviderMessage?: string;\n  smmAttempt?: number;\n  pollFailureCount?: number;\n  failReason?: string;\n  workerBatchDue?: number;\n  workerBatchClaimed?: number;\n  workerBatchErrors?: string[];\n  [key: string]: unknown;\n};\n';
text = text.replace(marker, marker + insert);
fs.writeFileSync(p, text, 'utf8');
console.log('OK: inserted notification interfaces after AdminAuditLog export');
