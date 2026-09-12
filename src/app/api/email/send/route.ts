import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/send  (admin only)
 *
 * Sends a transactional email through the configured SMTP transport
 * (nodemailer). Falls back to console logging when SMTP_* env vars are not
 * set (dev/preview mode) — the response always reports `delivered` honestly.
 *
 * Security:
 * - Requires an authenticated admin session (`requireAdmin`).
 * - Rate limited per admin account (10/min) to prevent abuse of the panel's
 *   mail reputation as a spam relay.
 * - Body is zod-validated; HTML is length-capped. Secrets never appear in the
 *   request/response or logs.
 *
 * Example request:
 *   POST /api/email/send
 *   Content-Type: application/json
 *   {
 *     "to": "customer@example.com",
 *     "subject": "Your order is complete",
 *     "html": "<p>Your order #42 has been delivered.</p>"
 *   }
 *
 * Example responses:
 *   200 { "success": true, "data": { "delivered": true },
 *         "message": "Email sent" }
 *   200 { "success": true, "data": { "delivered": false },
 *         "message": "SMTP not configured — email logged to server console" }
 *   401 { "success": false, "message": "Unauthorized - please sign in" }
 *   403 { "success": false, "message": "Forbidden - admin access required" }
 *   422 { "success": false, "message": "Enter a valid email address" }
 *   429 { "success": false, "message": "Too many requests..." }
 */
const sendEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email("Enter a valid email address"),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  html: z.string().min(1, "Message body is required").max(50_000),
});

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const limited = await limitOrFail(req, "general", `email-${admin._id}`);
    if (limited) return fail(limited, 429);

    const parsed = sendEmailSchema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    }

    const result = await sendEmail(parsed.data);

    if (!result.delivered) {
      // Distinguish "not configured" from a hard failure without leaking
      // transport details to the client.
      return ok({ delivered: false }, "SMTP not configured — email logged to server console");
    }
    return ok({ delivered: true }, "Email sent");
  });
}