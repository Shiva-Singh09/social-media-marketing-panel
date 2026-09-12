"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, ListOrdered, LifeBuoy, Wallet, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Table, TableSkeleton } from "@/components/ui";
import { StatsCard } from "@/components/StatsCard";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, formatDate, formatINR, formatNumber } from "@/lib/utils";

type Stats = {
  balance: number;
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  totalSpent: number;
  openTickets: number;
  recentOrders: {
    id: number;
    link: string;
    quantity: number;
    totalCost: string;
    status: string;
    createdAt: string;
    serviceName: string;
  }[];
  recentTransactions: {
    id: number;
    type: string;
    amount: string;
    description: string | null;
    paymentStatus: string;
    createdAt: string;
  }[];
  spendSeries: { day: string; total: number }[];
};

export default function DashboardPage() {
  const { user, settings } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<Stats>("/api/user/dashboard-stats");
      if (res.success) setStats(res.data);
      setLoading(false);
    })();
  }, []);

  const maxSpend = Math.max(1, ...(stats?.spendSeries.map((s) => s.total) ?? [1]));

  return (
    <div className="space-y-6">
      {settings?.announcementText ? (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
          📢 {settings.announcementText}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400">
            Track your balance, orders and spending at a glance.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/add-funds">
            <Button variant="secondary">
              <Wallet className="h-4 w-4" /> Add funds
            </Button>
          </Link>
          <Link href="/new-order">
            <Button>
              <Plus className="h-4 w-4" /> New order
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          label="Wallet balance"
          value={stats?.balance ?? Number(user?.creditBalance ?? 0)}
          prefix="₹"
          decimals={2}
          accent="emerald"
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatsCard
          label="Total orders"
          value={stats?.totalOrders ?? 0}
          accent="blue"
          icon={<ListOrdered className="h-5 w-5" />}
          hint={`${stats?.activeOrders ?? 0} in progress`}
        />
        <StatsCard
          label="Completed"
          value={stats?.completedOrders ?? 0}
          accent="violet"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatsCard
          label="Total spent"
          value={stats?.totalSpent ?? 0}
          prefix="₹"
          decimals={2}
          accent="amber"
          icon={<Clock3 className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent orders"
            subtitle="Your last 5 orders"
            action={
              <Link href="/orders" className="text-sm text-blue-400 hover:text-blue-300">
                View all →
              </Link>
            }
          />
          {loading ? (
            <TableSkeleton />
          ) : stats && stats.recentOrders.length > 0 ? (
            <Table head={["ID", "Service", "Qty", "Cost", "Status", "Date"]}>
              {stats.recentOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3">
                    <Link href={`/orders/${order.id}`} className="text-blue-400 hover:text-blue-300">
                      #{order.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-200">{order.serviceName}</td>
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
            <EmptyState
              title="No orders yet"
              description="Place your first order to see it here."
              action={
                <Link href="/new-order">
                  <Button size="sm">Place an order</Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Spending" subtitle="Last 7 days" />
          {stats && stats.spendSeries.length > 0 ? (
            <div className="flex h-40 items-end gap-2">
              {stats.spendSeries.map((point) => (
                <div key={point.day} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-blue-500/40 to-violet-500"
                    style={{ height: `${Math.max(6, (point.total / maxSpend) * 100)}%` }}
                    title={formatINR(point.total)}
                  />
                  <span className="text-[10px] text-slate-500">{point.day}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">No spending in the last week.</p>
          )}

          <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
            <p className="text-sm font-medium text-slate-300">Recent transactions</p>
            {stats?.recentTransactions.length ? (
              stats.recentTransactions.map((txn) => (
                <div key={txn.id} className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2 text-slate-400">{txn.description}</span>
                  <span
                    className={txn.type === "credit" ? "text-emerald-300" : "text-red-300"}
                  >
                    {txn.type === "credit" ? "+" : "−"}
                    {formatINR(txn.amount)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">No transactions yet.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Card className="sm:col-span-2">
          <CardHeader title="Quick actions" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Link href="/new-order">
              <Button variant="secondary" className="w-full">
                Place order
              </Button>
            </Link>
            <Link href="/add-funds">
              <Button variant="secondary" className="w-full">
                Add funds
              </Button>
            </Link>
            <Link href="/support">
              <Button variant="secondary" className="w-full">
                Get support
              </Button>
            </Link>
          </div>
        </Card>
        <StatsCard
          label="Open tickets"
          value={stats?.openTickets ?? 0}
          accent="rose"
          icon={<LifeBuoy className="h-5 w-5" />}
          hint="Support responds within 30 min"
        />
      </div>
    </div>
  );
}
