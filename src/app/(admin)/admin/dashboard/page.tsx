"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, IndianRupee, LifeBuoy, ShoppingCart, Users } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Table, TableSkeleton } from "@/components/ui";
import { StatsCard } from "@/components/StatsCard";
import { apiFetch, formatDate, formatINR, formatNumber } from "@/lib/utils";

type AdminStats = {
  users: { total: number; blocked: number; newToday: number; totalBalance: number };
  orders: { total: number; pending: number; completed: number; revenue: number };
  payments: { deposits: number; failed: number };
  tickets: { open: number; total: number };
  recentOrders: {
    id: number;
    status: string;
    totalCost: string;
    quantity: number;
    createdAt: string;
    serviceName: string;
    userName: string;
  }[];
  revenueSeries: { day: string; total: number }[];
  topServices: { name: string; orderCount: number; revenue: number }[];
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<AdminStats>("/api/admin/dashboard");
      if (res.success) setStats(res.data);
      setLoading(false);
    })();
  }, []);

  const maxRevenue = Math.max(1, ...(stats?.revenueSeries.map((r) => r.total) ?? [1]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin overview</h1>
        <p className="text-sm text-slate-400">Platform health, revenue and operations at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          label="Total users"
          value={stats?.users.total ?? 0}
          accent="blue"
          icon={<Users className="h-5 w-5" />}
          hint={`${stats?.users.newToday ?? 0} joined today`}
        />
        <StatsCard
          label="Order revenue"
          value={stats?.orders.revenue ?? 0}
          prefix="₹"
          decimals={2}
          accent="emerald"
          icon={<IndianRupee className="h-5 w-5" />}
          hint={`${stats?.orders.total ?? 0} orders total`}
        />
        <StatsCard
          label="Pending orders"
          value={stats?.orders.pending ?? 0}
          accent="amber"
          icon={<ShoppingCart className="h-5 w-5" />}
          hint={`${stats?.orders.completed ?? 0} completed`}
        />
        <StatsCard
          label="Open tickets"
          value={stats?.tickets.open ?? 0}
          accent="rose"
          icon={<LifeBuoy className="h-5 w-5" />}
          hint={`${stats?.tickets.total ?? 0} lifetime`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue" subtitle="Last 7 days of order volume" />
          {stats && stats.revenueSeries.length > 0 ? (
            <div className="flex h-48 items-end gap-3">
              {stats.revenueSeries.map((point) => (
                <div key={point.day} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-[10px] text-slate-400">{formatINR(point.total)}</span>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-blue-500/40 to-violet-500"
                    style={{ height: `${Math.max(6, (point.total / maxRevenue) * 100)}%` }}
                  />
                  <span className="text-[10px] text-slate-500">{point.day}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-14 text-center text-sm text-slate-500">No revenue in the last week.</p>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Wallet liability" />
            <p className="text-3xl font-bold text-white">
              {formatINR(stats?.users.totalBalance ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Unspent credits held by users</p>
            <div className="mt-4 space-y-2 border-t border-slate-800 pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Successful deposits</span>
                <span className="text-emerald-300">{formatINR(stats?.payments.deposits ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Failed payments</span>
                <span className="text-red-300">{stats?.payments.failed ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Blocked users</span>
                <span className="text-amber-300">{stats?.users.blocked ?? 0}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Top services" />
            {stats?.topServices.length ? (
              <ul className="space-y-2 text-sm">
                {stats.topServices.map((service) => (
                  <li key={service.name} className="flex items-center justify-between gap-3">
                    <span className="truncate text-slate-300">{service.name}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {service.orderCount} × · {formatINR(service.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No orders yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Latest orders"
          action={
            <Link href="/admin/orders" className="text-sm text-blue-400 hover:text-blue-300">
              Manage orders →
            </Link>
          }
        />
        {loading ? (
          <TableSkeleton />
        ) : stats && stats.recentOrders.length > 0 ? (
          <Table head={["ID", "Customer", "Service", "Qty", "Amount", "Status", "Date"]}>
            {stats.recentOrders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-900/50">
                <td className="px-4 py-3 text-slate-400">#{order.id}</td>
                <td className="px-4 py-3 text-slate-200">{order.userName}</td>
                <td className="px-4 py-3">{order.serviceName}</td>
                <td className="px-4 py-3">{formatNumber(order.quantity)}</td>
                <td className="px-4 py-3">{formatINR(order.totalCost)}</td>
                <td className="px-4 py-3">
                  <Badge status={order.status} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(order.createdAt)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No orders yet" description="Orders will appear here as they arrive." />
        )}
      </Card>

      {stats && stats.orders.pending > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="h-5 w-5" />
          {stats.orders.pending} order(s) are waiting to be processed.
          <Link href="/admin/orders" className="ml-auto font-semibold underline">
            Review now
          </Link>
        </div>
      ) : null}
    </div>
  );
}
