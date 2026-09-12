/**
 * GET /api/credits/balance — current credit balance for the signed-in user.
 *
 * The balance lives on the User document (`creditBalance`) and is mutated
 * ONLY inside MongoDB transactions:
 *   - credited by /api/payment/webhook (and /api/payment/verify) after a
 *     successful Razorpay capture,
 *   - debited by /api/services/order when a service is consumed.
 *
 * Response: { success, data: { balance, currency, updatedAt }, message }
 */

import { fail, handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "general", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    return ok(
      {
        balance: num(user.creditBalance),
        currency: "INR",
        updatedAt: user.updatedAt,
      },
      "Balance loaded",
    );
  });
}