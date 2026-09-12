import mongoose from "mongoose";
import { AdminAuditLog } from "@/db/mongodb-schema";

/**
 * Records a sensitive admin action for traceability. Failures here are
 * logged but never block the primary request — the audit trail is
 * best-effort and must not become a new source of outages.
 */
export async function recordAudit(input: {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: unknown;
}) {
  try {
    await AdminAuditLog.create({
      adminId: new mongoose.Types.ObjectId(input.adminId),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId !== undefined && input.targetId !== null ? String(input.targetId) : null,
      details: input.details !== undefined ? JSON.stringify(input.details) : null,
    });
  } catch (error) {
     
    console.error("[audit:error]", error);
  }
}
