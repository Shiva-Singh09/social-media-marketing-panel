"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import { apiFetch, formatDate, formatINR, formatNumber } from "@/lib/utils";

type OrderDetail = {
  id: number;
  link: string;
  quantity: number;
  totalCost: string;
  status: string;
  startCount: number | null;
  remains: number | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  serviceName: string;
  serviceDescription: string | null;
  /** Rate actually charged for THIS order (totalCost ÷ qty × 1000). */
  effectiveRatePer1000?: number;
  pricePer1000: string;
  categoryName: string;
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<OrderDetail>(`/api/orders/${params.id}`);
      if (res.success) setOrder(res.data);
      setLoading(false);
    })();
  }, [params.id]);

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!order) {
    return (
      <EmptyState
        title="Order not found"
        description="This order does not exist or belongs to another account."
        action={
          <Link href="/orders">
            <Button size="sm">Back to orders</Button>
          </Link>
        }
      />
    );
  }

  const delivered = order.remains !== null ? order.quantity - order.remains : null;
  const progress =
    delivered !== null ? Math.min(100, Math.max(0, (delivered / order.quantity) * 100)) : 0;

  return (
    <div className="space-y-6">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to orders
      </Link>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Order #${order.id}`}
            subtitle={`${order.categoryName} · ${order.serviceName}`}
            action={<Badge status={order.status} />}
          />

          <div className="mb-5">
            <div className="mb-2 flex justify-between text-xs text-slate-400">
              <span>Delivery progress</span>
              <span>
                {delivered !== null ? formatNumber(delivered) : 0} / {formatNumber(order.quantity)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                style={{ width: `${order.status === "completed" ? 100 : progress}%` }}
              />
            </div>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              { label: "Quantity", value: formatNumber(order.quantity) },
              { label: "Total cost", value: formatINR(order.totalCost) },
              {
                label: "Rate / 1000",
                // The rate ACTUALLY charged for this order — always multiplies
                // out to the total above, so receipts never contradict prices.
                value: formatINR(order.effectiveRatePer1000 ?? Number(order.pricePer1000)),
              },
              {
                label: "Start count",
                value: order.startCount !== null ? formatNumber(order.startCount) : "—",
              },
              { label: "Remains", value: order.remains !== null ? formatNumber(order.remains) : "—" },
              { label: "Placed", value: formatDate(order.createdAt) },
              { label: "Last update", value: formatDate(order.updatedAt) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">{item.label}</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-100">{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Target link</p>
            <a
              href={order.link}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 break-all text-sm text-blue-400 hover:text-blue-300"
            >
              {order.link}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          {order.adminNote ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p className="text-xs font-semibold uppercase tracking-wide">Admin note</p>
              <p className="mt-1">{order.adminNote}</p>
            </div>
          ) : null}
        </Card>

        <Card className="h-fit">
          <CardHeader title="Service details" />
          <p className="text-sm text-slate-300">{order.serviceName}</p>
          <p className="mt-2 text-sm text-slate-400">
            {order.serviceDescription ?? "No description provided for this service."}
          </p>
          <div className="mt-5 space-y-2">
            <Link href="/new-order">
              <Button className="w-full" variant="secondary">
                Reorder
              </Button>
            </Link>
            <Link href="/support">
              <Button className="w-full" variant="outline">
                Report an issue
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
