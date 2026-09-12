/**
 * POST /api/services/order — automated service ordering with credit deduction.
 *
 * End-to-end flow (single request):
 *   1. Validate input (zod) + ownership-free public checks.
 *   2. Load the panel Service → resolve PROVIDER cost + markup.
 *      userCost = quantity/1000 × providerCostPer1000 × (1 + markupPercent/100)
 *      e.g. provider charges 100 → user is deducted 130 (default +30%).
 *   3. ATOMIC MongoDB transaction:
 *        - conditionally deduct credits (only if balance ≥ cost),
 *        - create the Order (status=pending) + debit Transaction.
 *   4. Place the order at the SMM provider (`action=add`).
 *        - success → Order becomes `processing` with its smmOrderId stored;
 *        - failure → compensating transaction REFUNDS the credits, marks the
 *          Order `failed` and records a refund Transaction. The user is never
 *          charged for an order the provider did not accept.
 *
 * Credits are ADDED by the Razorpay webhook (/api/payment/webhook) after a
 * successful payment capture — see README_SMM_INTEGRATION.md §7.
 */

import { Order, Service, Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { fail, handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { userCostForQuantity, resolveServicePricing } from "@/lib/pricing";
import { addOrder, isProviderConfigured, SmmApiError } from "@/lib/smm-client";
import { firstError, serviceOrderSchema } from "@/lib/smm-validators";
import { isAllowedSocialLink } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "order", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = serviceOrderSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { serviceId, link, quantity } = parsed.data;

    // ---- Load service + its category (for platform-scoped link checks) ----
    const service = await Service.findById(serviceId)
      .populate("categoryId", "platformKey name")
      .lean();
    if (!service) return fail("Service not found", 404);

    const category = service.categoryId as unknown as
      | { platformKey?: string | null; name?: string }
      | undefined;

    if (service.status !== "active") return fail("This service is currently unavailable", 400);
    if (quantity < service.minQuantity || quantity > service.maxQuantity) {
      return fail(
        `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`,
        422,
      );
    }

    const linkCheck = isAllowedSocialLink(link, category?.platformKey ?? undefined);
    if (!linkCheck.ok) return fail(linkCheck.reason ?? "Invalid link", 422);

    // Automated flow requires a mapped provider service id.
    if (!service.providerServiceId) {
      return fail(
        "This service is not enabled for automated ordering yet — please contact support",
        409,
      );
    }
    if (!isProviderConfigured()) {
      return fail("Ordering is temporarily unavailable — provider not configured", 503);
    }

    // ---- Price server-side; NEVER trust a client-supplied amount ----
    const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
    const totalCost = userCostForQuantity(quantity, providerCostPer1000, markupPercent);
    if (totalCost <= 0) return fail("Calculated order cost is invalid", 400);

    if (num(user.creditBalance) < totalCost) {
      return fail(
        `Insufficient balance. This order costs ${totalCost.toFixed(2)} credits — please add funds first.`,
        402,
      );
    }

    // ---- Phase 1: atomically deduct credits + persist the order ----
    // (real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB — see src/db/transactions.ts)
    const holder: { orderId?: string; balance?: number } = {};
    const { ok: deducted, error: txError } = await runInTransaction(async (session) => {
      // Conditional decrement: only subtract when the balance covers the cost.
      // `updatePipeline: true` is REQUIRED in Mongoose 9 for pipeline updates.
      const updated = await User.findByIdAndUpdate(
        user._id,
        [
          {
            $set: {
              creditBalance: {
                $cond: [
                  { $gte: ["$creditBalance", totalCost] },
                  { $round: [{ $subtract: ["$creditBalance", totalCost] }, 2] },
                  "$creditBalance",
                ],
              },
            },
          },
        ],
        { returnDocument: "after", updatePipeline: true, ...txOpts(session) },
      );
      if (!updated) throw new Error("User not found");

      // If funds were insufficient the $cond left the balance untouched —
      // detect that instead of trusting the client-side pre-check alone
      // (two concurrent orders could otherwise both pass the check).
      const newBalance = num(updated.creditBalance);
      if (Math.abs(newBalance - (num(user.creditBalance) - totalCost)) > 0.001) {
        throw new Error("Insufficient balance");
      }

      const [order] = await Order.create(
        [
          {
            userId: user._id,
            serviceId: service._id,
            link,
            quantity,
            totalCost,
            status: "pending",
            remains: quantity,
          },
        ],
        { ...txOpts(session) },
      );

      await Transaction.create(
        [
          {
            userId: user._id,
            type: "debit",
            amount: totalCost,
            description: `Order #${order._id} — ${service.name} (${markupPercent}% margin)`,
            paymentStatus: "success",
          },
        ],
        txOpts(session),
      );

      holder.orderId = String(order._id);
      holder.balance = newBalance;
    });

    if (!deducted || !holder.orderId) {
      // Distinguish a genuine balance shortfall from unexpected failures.
      const reason = txError instanceof Error ? txError.message : "";
      if (reason === "Insufficient balance" || !holder.orderId) {
        return fail(
          `Insufficient balance: this order costs ${totalCost.toFixed(2)} credits but your balance is ${num(
            user.creditBalance,
          ).toFixed(2)}. Please add funds first.`,
          402,
          { required: totalCost, balance: num(user.creditBalance) },
        );
      }
      console.error("[services:order] deduction failed", { reason: reason.slice(0, 160) });
      return fail("Could not place the order right now. Please try again.", 500);
    }

    // ---- Phase 2: place the order at the SMM provider ----
    try {
      const { orderId: providerOrderId } = await addOrder({
        service: service.providerServiceId,
        link,
        quantity,
      });

      await Order.updateOne(
        { _id: holder.orderId },
        { $set: { status: "processing", smmOrderId: providerOrderId } },
      );

      return ok(
        {
          orderId: holder.orderId,
          smmOrderId: providerOrderId,
          status: "processing",
          chargedCredits: totalCost,
          providerCostPer1000,
          markupPercent,
          balance: holder.balance,
        },
        "Order placed successfully",
        201,
      );
    } catch (error) {
      // ---- Compensating action: refund what phase 1 deducted ----
      const reason =
        error instanceof SmmApiError ? error.message : "Provider rejected the order";
      await runInTransaction(async (session) => {
        await User.findByIdAndUpdate(
          user._id,
          { $inc: { creditBalance: totalCost } },
          txOpts(session),
        );
        await Order.updateOne(
          { _id: holder.orderId },
          { $set: { status: "failed", adminNote: reason.slice(0, 300) } },
          txOpts(session),
        );
        await Transaction.create(
          [
            {
              userId: user._id,
              type: "credit",
              amount: totalCost,
              description: `Refund for failed order #${holder.orderId}`,
              paymentStatus: "success",
            },
          ],
          txOpts(session),
        );
      });

      console.error("[services:order] provider placement failed; refunded", {
        orderId: holder.orderId,
        kind: error instanceof SmmApiError ? error.kind : "unknown",
      });

      return fail(`Order could not be placed: ${reason}. Your credits have been refunded.`, 502, {
        orderId: holder.orderId,
        refunded: totalCost,
      });
    }
  });
}