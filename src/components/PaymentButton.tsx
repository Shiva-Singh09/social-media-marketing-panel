"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch, formatINR } from "@/lib/utils";

type CreateOrderResponse = {
  transactionId: number;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  demoMode: boolean;
  siteName: string;
  user: { name: string; email: string };
};

type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function PaymentButton({
  amount,
  disabled,
  onSuccess,
}: {
  amount: number;
  disabled?: boolean;
  onSuccess: (balance: number) => void;
}) {
  const [loading, setLoading] = useState(false);

  const verify = async (payload: Partial<RazorpayHandlerResponse> & { demo?: boolean }) => {
    const res = await apiFetch<{ balance: number; amount: number }>("/api/payment/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    onSuccess(res.data?.balance ?? 0);
  };

  const start = async () => {
    setLoading(true);
    const created = await apiFetch<CreateOrderResponse>("/api/payment/create-order", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });

    if (!created.success || !created.data) {
      setLoading(false);
      toast.error(created.message);
      return;
    }

    const data = created.data;

    // Demo checkout — no live Razorpay keys configured on this deployment.
    if (data.demoMode) {
      toast.loading("Simulating Razorpay checkout…", { id: "demo-pay" });
      window.setTimeout(async () => {
        toast.dismiss("demo-pay");
        await verify({
          razorpay_order_id: data.orderId,
          razorpay_payment_id: `pay_demo_${Date.now()}`,
          demo: true,
        });
        setLoading(false);
      }, 900);
      return;
    }

    const ready = await loadRazorpayScript();
    if (!ready || !window.Razorpay) {
      setLoading(false);
      toast.error("Unable to load Razorpay checkout");
      return;
    }

    const rzp = new window.Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: data.siteName,
      description: `Wallet top-up of ${formatINR(amount)}`,
      order_id: data.orderId,
      prefill: { name: data.user.name, email: data.user.email },
      theme: { color: "#3b82f6" },
      handler: (response: RazorpayHandlerResponse) => {
        void verify(response).finally(() => setLoading(false));
      },
      modal: {
        ondismiss: () => {
          setLoading(false);
          toast("Payment cancelled", { icon: "⚠️" });
        },
      },
    });
    rzp.open();
  };

  return (
    <Button className="w-full" onClick={start} loading={loading} disabled={disabled}>
      <Wallet className="h-4 w-4" />
      Pay {formatINR(amount)}
    </Button>
  );
}
