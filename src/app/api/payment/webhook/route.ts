import { Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { fail, handle, num, ok } from "@/lib/api";
import { verifyWebhookSignature } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhook — backup verification path.
 * Credits are only added when the matching transaction is still pending.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const raw = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    if (!verifyWebhookSignature(raw, signature)) {
       
      console.warn("[razorpay:webhook] invalid signature");
      return fail("Invalid webhook signature", 400);
    }

    const event = JSON.parse(raw) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: { id?: string; order_id?: string; status?: string; amount?: number };
        };
      };
    };

    if (event.event !== "payment.captured") return ok({ ignored: true }, "Event ignored");
    const entity = event.payload?.payment?.entity;
    if (!entity?.order_id) return ok({ ignored: true }, "No order id in payload");

    const txn = await Transaction.findOne({ razorpayOrderId: entity.order_id });
    if (!txn) return ok({ ignored: true }, "Unknown order");
    if (txn.paymentStatus === "success") return ok({ duplicate: true }, "Already credited");

    const amount = num(txn.amount);

    // Defense in depth: the webhook payload's amount (paise) must match what
    // we recorded when the order was created. A mismatch could indicate a
    // partial capture or a tampered payload — flag it instead of blindly
    // trusting the number and crediting the wrong amount.
    if (typeof entity.amount === "number") {
      const expectedPaise = Math.round(amount * 100);
      if (entity.amount !== expectedPaise) {
         
        console.error(
          `[razorpay:webhook] amount mismatch for order ${entity.order_id}: expected ${expectedPaise}, got ${entity.amount}`,
        );
        txn.paymentStatus = "failed";
        txn.razorpayPaymentId = entity.id ?? null;
        await txn.save();
        return fail("Amount mismatch between webhook payload and recorded transaction", 400);
      }
    }

    // Runs as a real ACID transaction on replica sets; falls back to plain
    // writes on standalone MongoDB (see src/db/transactions.ts).
    const { ok: succeeded } = await runInTransaction(async (session) => {
      await User.findByIdAndUpdate(
        txn.userId,
        { $inc: { creditBalance: amount } },
        txOpts(session),
      );
      txn.paymentStatus = "success";
      txn.razorpayPaymentId = entity.id ?? null;
      await txn.save(txOpts(session));
    });

    if (!succeeded) return fail("Webhook processing failed", 500);
    return ok({ credited: amount }, "Payment credited via webhook");
  });
}