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
    //
    // Conditional claim (P1): re-fetch the transaction inside the transaction
    // so we see any concurrent commit, then only transition PENDING→SUCCESS.
    // A concurrent verify/webhook that already committed leaves
    // paymentStatus=success, so the conditional update matches 0 documents
    // and we skip the credit — no double-credit under any interleaving.
    const holder: { balance: number; credited: boolean } = { balance: 0, credited: false };
    const { ok: succeeded } = await runInTransaction(async (session) => {
      // Claim FIRST: conditional PENDING→SUCCESS is the exactly-once mutex.
      // Only the winner proceeds to credit; losers return without writing.
      const claimed = await Transaction.updateOne(
        { _id: txn._id, paymentStatus: "pending" },
        {
          $set: {
            paymentStatus: "success",
            razorpayPaymentId: paymentId,
          },
        },
        txOpts(session),
      );
      if (claimed.matchedCount === 0) return; // another writer claimed first

      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $inc: { creditBalance: amount } },
        { returnDocument: "after", ...txOpts(session) },
      );
      holder.balance = num(updatedUser?.creditBalance);
      holder.credited = true;
    });

    if (!succeeded) return fail("Payment verification failed", 500);
    if (!holder.credited) {
      return ok({ alreadyProcessed: true, balance: num(user.creditBalance) }, "Payment already credited");
    }

    return ok({ balance: holder.balance, amount, paymentId }, `₹${amount.toFixed(2)} added to your balance`);
  });
}