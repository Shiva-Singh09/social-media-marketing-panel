import crypto from "node:crypto";

/**
 * Razorpay helper.
 *
 * When RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are present we talk to the real
 * Razorpay REST API. When they are missing the panel runs in *demo checkout*
 * mode so the full add-funds flow stays testable — the server still creates a
 * pending transaction and still performs the signature check, it just signs the
 * receipt itself instead of Razorpay doing it.
 */
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
/**
 * Explicit webhook secret. In production it MUST be configured separately —
 * never silently derived from the key secret (separate compromise domains,
 * separate rotation). In non-production the key-secret fallback remains only
 * so local/demo setups keep working.
 */
function resolveWebhookSecret(): string {
  const explicit = (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") return "";
  return RAZORPAY_KEY_SECRET;
}
export const RAZORPAY_WEBHOOK_SECRET = resolveWebhookSecret();

export function isRazorpayConfigured() {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}

/**
 * Demo checkout (self-signed receipts, no real money movement) is only ever
 * permitted outside production. If a production deployment forgets to
 * configure Razorpay keys, payments must fail loudly rather than silently
 * letting any authenticated user credit their own wallet for free.
 */
export function isDemoModeAllowed() {
  return !isRazorpayConfigured() && process.env.NODE_ENV !== "production";
}

export function publicKeyId() {
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || RAZORPAY_KEY_ID || "";
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
};

export async function createRazorpayOrder(
  amountInRupees: number,
  receipt: string,
): Promise<RazorpayOrder> {
  const amount = Math.round(amountInRupees * 100); // paise

  if (!isRazorpayConfigured()) {
    return {
      id: `order_demo_${crypto.randomBytes(9).toString("hex")}`,
      amount,
      currency: "INR",
      receipt,
    };
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount, currency: "INR", receipt, payment_capture: 1 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order creation failed: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as RazorpayOrder;
  return json;
}

/** HMAC_SHA256(order_id + "|" + payment_id, key_secret) === signature */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  if (!signature) return false;
  const secret = RAZORPAY_KEY_SECRET || "demo_secret";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Demo-mode signature so /api/payment/verify runs the exact same code path. */
export function demoSignature(orderId: string, paymentId: string) {
  return crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET || "demo_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}
