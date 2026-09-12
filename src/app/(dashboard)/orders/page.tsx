"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Pagination,
  Select,
  Table,
  TableSkeleton,
} from "@/components/ui";
import { ORDER_STATUSES } from "@/lib/validators";
import { apiFetch, formatDate, formatINR, formatNumber, statusLabel } from "@/lib/utils";

type OrderRow = {
  id: number;
  link: string;
  quantity: number;
  totalCost: string;
  status: string;
  remains: number | null;
  createdAt: string;
  serviceName: string;
  categoryName: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "10", status });
    if (debounced) params.set("search", debounced);
    const res = await apiFetch<{
      orders: OrderRow[];
      pagination: { pages: number };
    }>(`/api/orders?${params}`);
    if (res.success && res.data) {
      setOrders(res.data.orders);
      setPages(res.data.pagination.pages);
    }
    setLoading(false);
  }, [page, status, debounced]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">My orders</h1>
          <p className="text-sm text-slate-400">Track delivery status for every order.</p>
        </div>
        <Link href="/new-order">
          <Button>New order</Button>
        </Link>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              className="pl-9"
              placeholder="Search by link…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
          <Select
            className="w-48"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="all">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders found"
            description="Try a different filter or place your first order."
            action={
              <Link href="/new-order">
                <Button size="sm">Place an order</Button>
              </Link>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table head={["ID", "Service", "Link", "Qty", "Cost", "Status", "Date", ""]}>
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-medium text-slate-200">#{order.id}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-200">{order.serviceName}</p>
                      <p className="text-xs text-slate-500">{order.categoryName}</p>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-blue-400">
                      {order.link}
                    </td>
                    <td className="px-4 py-3">{formatNumber(order.quantity)}</td>
                    <td className="px-4 py-3">{formatINR(order.totalCost)}</td>
                    <td className="px-4 py-3">
                      <Badge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/orders/${order.id}`}
                        className="text-sm text-blue-400 hover:text-blue-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="block rounded-xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-100">#{order.id}</span>
                    <Badge status={order.status} />
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{order.serviceName}</p>
                  <p className="truncate text-xs text-blue-400">{order.link}</p>
                  <div className="mt-2 flex justify-between text-xs text-slate-500">
                    <span>Qty {formatNumber(order.quantity)}</span>
                    <span>{formatINR(order.totalCost)}</span>
                  </div>
                </Link>
              ))}
            </div>

            <Pagination page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
