"use client";

/**
 * ServiceOrderForm — end-to-end credit consumption example.
 *
 * Flow demonstrated:
 *   1. Balance is read from the auth context (kept fresh via /api/auth/me,
 *      and re-fetched after every order).
 *   2. Services are listed from /api/services/[categoryId]; each carries a
 *      `userPricePer1000` computed SERVER-SIDE with the markup applied —
 *      provider costs are never exposed to the client.
 *   3. The live total preview uses that same server-provided price, so what
 *      the user sees always matches what POST /api/services/order deducts.
 *   4. On submit the backend atomically deducts credits and places the SMM
 *      provider order; on provider failure credits are refunded automatically.
 *
 * Credits are purchased beforehand via Razorpay Checkout (/add-funds →
 * /api/payment/create-order → webhook credits the balance).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ShoppingCart } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  Select,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, formatINR } from "@/lib/utils";

type Category = { id: string; name: string; serviceCount: number };
type Service = {
  id: string;
  name: string;
  description?: string | null;
  userPricePer1000: number;
  minQuantity: number;
  maxQuantity: number;
};

type OrderResponse = {
  orderId: string;
  smmOrderId: number | null;
  status: string;
  chargedCredits: number;
  balance: number;
  duplicate?: boolean;
};

export default function ServiceOrderForm() {
  const { user, refresh } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [link, setLink] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loadingServices, setLoadingServices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Idempotency key (Phase 2C-4): reused across re-submissions of the SAME
  // logical order (e.g. a duplicate click while a request is in flight) so the
  // server replays the original order instead of debiting the wallet twice.
  const requestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<{ categories: Category[] }>("/api/services/categories");
      if (res.success && res.data) {
        setCategories(res.data.categories);
        if (res.data.categories[0]) setCategoryId(res.data.categories[0].id);
      }
    })();
  }, []);

  // NOTE: no synchronous setState in the effect body (React hooks lint rule).
  // `loadingServices` starts true and flips false after the first fetch; on
  // category switches the previous list stays visible until the new one lands.
  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    void (async () => {
      const res = await apiFetch<{ services: Service[] }>(`/api/services/${categoryId}`);
      if (cancelled) return;
      if (res.success && res.data) {
        setServices(res.data.services);
        setServiceId(res.data.services[0]?.id ?? "");
      }
      setLoadingServices(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const service = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const qty = Number.parseInt(quantity || "0", 10) || 0;
  // Preview uses the SERVER-computed marked-up price — identical formula to
  // what the backend will deduct.
  const estimatedCost = service ? Math.round((qty / 1000) * service.userPricePer1000 * 100) / 100 : 0;
  const balance = Number(user?.creditBalance ?? 0);
  const insufficient = estimatedCost > balance;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!service) return toast.error("Select a service first");
    if (qty < service.minQuantity || qty > service.maxQuantity) {
      return toast.error(`Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`);
    }
    if (insufficient) return toast.error("Insufficient balance — please add funds first");

    setSubmitting(true);
    const res = await apiFetch<OrderResponse>("/api/services/order", {
      method: "POST",
      body: JSON.stringify({
        serviceId: service.id,
        link,
        quantity: qty,
        // Idempotency: if this logical order is submitted again (duplicate
        // click/retry), the server returns the original order untouched.
        clientRequestId: requestIdRef.current,
      }),
    });
    setSubmitting(false);
    // A completed response is definitive — the NEXT order gets a fresh key. (A
    // request that never produced a response is NOT regenerated here: retrying
    // it reuses the old key and the server safely replays the original order.)
    requestIdRef.current = crypto.randomUUID();

    if (!res.success || !res.data) return toast.error(res.message);
    toast.success(
      res.data.smmOrderId
        ? `Order placed — provider order #${res.data.smmOrderId}`
        : "Order placed — queued for provider submission",
    );
    await refresh(); // pull the new credit balance into the UI
  };

  return (
    <Card>
      <CardHeader
        title="Order with credits"
        subtitle={`Balance: ${formatINR(balance)} · prices include panel margin`}
      />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="so-category">Category</Label>
            <Select id="so-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="so-service">Service</Label>
            <Select
              id="so-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              disabled={loadingServices || services.length === 0}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatINR(s.userPricePer1000)}/1k
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="so-link">Target link</Label>
          <Input
            id="so-link"
            type="url"
            required
            placeholder="https://instagram.com/p/abc"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="so-quantity">Quantity</Label>
          <Input
            id="so-quantity"
            type="number"
            required
            min={service?.minQuantity ?? 1}
            max={service?.maxQuantity ?? 10_000_000}
            placeholder={service ? `${service.minQuantity} – ${service.maxQuantity}` : "0"}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
          <span className="text-slate-400">Total cost</span>
          <span className={insufficient ? "font-semibold text-red-400" : "font-semibold text-emerald-300"}>
            {formatINR(estimatedCost)}
          </span>
        </div>

        <Button type="submit" loading={submitting} disabled={!service} className="w-full">
          <ShoppingCart className="h-4 w-4" />
          Place order · {formatINR(estimatedCost)}
        </Button>
      </form>
    </Card>
  );
}