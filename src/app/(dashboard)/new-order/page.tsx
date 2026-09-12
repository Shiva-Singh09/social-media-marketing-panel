"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Info, ShoppingCart } from "lucide-react";
import { Button, Card, CardHeader, Input, Label, Select, Skeleton } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, formatINR, formatNumber, orderCost } from "@/lib/utils";

type Category = { id: string; name: string; serviceCount: number };
type Service = {
  // Mongo ObjectIds are strings — the old `number` types never matched the API.
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  /** Raw admin-set rate (informational). */
  pricePer1000: number;
  /** Server-computed rate INCLUDING margin — exactly what an order is charged. */
  userPricePer1000: number;
  minQuantity: number;
  maxQuantity: number;
};

export default function NewOrderPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [link, setLink] = useState("");
  const [quantity, setQuantity] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingServices, setLoadingServices] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<{ categories: Category[] }>("/api/services/categories");
      if (res.success && res.data) {
        setCategories(res.data.categories);
        if (res.data.categories[0]) setCategoryId(String(res.data.categories[0].id));
      }
      setLoading(false);
    })();
  }, []);

  // Data fetching on category change necessarily resolves into setState; the
  // strict react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    if (!categoryId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingServices(true);
    void (async () => {
      const res = await apiFetch<{ services: Service[] }>(`/api/services/${categoryId}`);
      if (res.success && res.data) {
        setServices(res.data.services);
        setServiceId(res.data.services[0] ? String(res.data.services[0].id) : "");
      }
      setLoadingServices(false);
    })();
  }, [categoryId]);

  const service = useMemo(
    () => services.find((s) => String(s.id) === serviceId) ?? null,
    [services, serviceId],
  );

  const qty = Number.parseInt(quantity || "0", 10) || 0;
  // Preview with the SAME server-provided marked-up rate that /api/orders
  // charges (`resolveServicePricing` → `userCostForQuantity`). Previously this
  // page read a non-existent/Decimal128 field, rendered ₹0.00 and let orders
  // through that the server then rejected with a misleading 402.
  const cost = service ? orderCost(qty, Number(service.userPricePer1000 ?? service.pricePer1000)) : 0;
  const balance = Number(user?.creditBalance ?? 0);
  const insufficient = cost > balance;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!service) return toast.error("Select a service first");
    if (qty < service.minQuantity || qty > service.maxQuantity) {
      return toast.error(
        `Quantity must be between ${formatNumber(service.minQuantity)} and ${formatNumber(service.maxQuantity)}`,
      );
    }
    if (insufficient) return toast.error("Insufficient balance — please add funds");

    setSubmitting(true);
    const res = await apiFetch<{ order: { id: number } }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ serviceId: service.id, link, quantity: qty }),
    });
    setSubmitting(false);

    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await refresh();
    router.push(`/orders/${res.data?.order.id ?? ""}`);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Place a new order</h1>
        <p className="text-sm text-slate-400">
          Choose a category and service, paste your public link, and confirm.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  id="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({cat.serviceCount})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="service">Service</Label>
                <Select
                  id="service"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  disabled={loadingServices || services.length === 0}
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {formatINR(s.pricePer1000)}/1k
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {service?.description ? (
              <div className="flex gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>{service.description}</span>
              </div>
            ) : null}

            <div>
              <Label htmlFor="link">Link</Label>
              <Input
                id="link"
                type="url"
                required
                placeholder="https://instagram.com/yourprofile"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Public profile or post URL. We never ask for your password.
              </p>
            </div>

            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                required
                min={service?.minQuantity ?? 1}
                max={service?.maxQuantity ?? 1000000}
                placeholder={service ? `${service.minQuantity} – ${service.maxQuantity}` : "0"}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {service ? (
                <p className="mt-1 text-xs text-slate-500">
                  Min {formatNumber(service.minQuantity)} · Max {formatNumber(service.maxQuantity)}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" loading={submitting} disabled={!service}>
              <ShoppingCart className="h-4 w-4" />
              Confirm order · {formatINR(cost)}
            </Button>
          </form>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Order summary" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Service</dt>
              <dd className="max-w-[60%] text-right text-slate-200">{service?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Rate / 1000</dt>
              <dd className="text-slate-200">
                {service ? formatINR(service.userPricePer1000) : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Quantity</dt>
              <dd className="text-slate-200">{formatNumber(qty)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3 text-base font-semibold">
              <dt className="text-slate-300">Total</dt>
              <dd className="text-emerald-300">{formatINR(cost)}</dd>
            </div>
            <div className="flex justify-between text-xs">
              <dt className="text-slate-500">Wallet balance</dt>
              <dd className={insufficient ? "text-red-400" : "text-slate-400"}>
                {formatINR(balance)}
              </dd>
            </div>
          </dl>

          {insufficient ? (
            <Link href="/add-funds" className="mt-4 block">
              <Button variant="secondary" className="w-full">
                Add funds
              </Button>
            </Link>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
