import crypto from "node:crypto";
import { Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { fail, handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { demoSignature, isDemoModeAllowed, verifyPaymentSignature } from "@/lib/razorpay";
import { firstError, verifyPaymentSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * Server-side verification — the frontend result is never trusted.
 * signature must equal HMAC_SHA256(order_id|payment_id, key_secret).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "payment", `verify-${user._id}`);
    if (limited) return fail(limited, 429);

    const parsed = verifyPaymentSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const orderId = parsed.data.razorpay_order_id;
    let paymentId = parsed.data.razorpay_payment_id;
    let signature = parsed.data.razorpay_signature;

    const txn = await Transaction.findOne({
      razorpayOrderId: orderId,
      userId: user._id,
    });

    if (!txn) return fail("Payment record not found", 404);
    if (txn.paymentStatus === "success") {
      return ok({ alreadyProcessed: true, balance: num(user.creditBalance) }, "Payment already credited");
    }

    // Demo checkout only runs outside production and only when the client
    // explicitly opted into it AND the server independently confirms Razorpay
    // isn't configured. In production this branch never executes, so
    // `demo: true` from a malicious client has no effect — the real
    // signature check below will simply fail.
    if (isDemoModeAllowed() && parsed.data.demo) {
      paymentId = paymentId || `pay_demo_${crypto.randomBytes(8).toString("hex")}`;
      signature = demoSignature(orderId, paymentId);
    }

    const valid = verifyPaymentSignature(orderId, paymentId, signature);
    if (!valid) {
      txn.paymentStatus = "failed";
      txn.razorpayPaymentId = paymentId;
      await txn.save();
      return fail("Payment signature verification failed", 400);
    }

    const amount = num(txn.amount);

    // Real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB (see src/db/transactions.ts).
    const holder: { balance: number } = { balance: 0 };
    const { ok: succeeded } = await runInTransaction(async (session) => {
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $inc: { creditBalance: amount } },
        { returnDocument: "after", ...txOpts(session) },
      );
      txn.paymentStatus = "success";
      txn.razorpayPaymentId = paymentId;
      await txn.save(txOpts(session));
      holder.balance = num(updatedUser?.creditBalance);
    });

    if (!succeeded) return fail("Payment verification failed", 500);

    return ok({ balance: holder.balance, amount, paymentId }, `₹${amount.toFixed(2)} added to your balance`);
  });
}