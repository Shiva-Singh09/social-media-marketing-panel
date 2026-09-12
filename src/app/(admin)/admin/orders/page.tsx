"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Pagination,
  Select,
  Table,
  TableSkeleton,
  Textarea,
} from "@/components/ui";
import { ORDER_STATUSES } from "@/lib/validators";
import { apiFetch, formatDate, formatINR, formatNumber, statusLabel } from "@/lib/utils";

type OrderRow = {
  id: number;
  link: string;
  quantity: number;
  totalCost: string;
  status: string;
  startCount: number | null;
  remains: number | null;
  adminNote: string | null;
  createdAt: string;
  serviceName: string;
  categoryName: string;
  userName: string;
  userEmail: string;
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [form, setForm] = useState({ status: "pending", startCount: "", remains: "", adminNote: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "12", status });
    if (debounced) params.set("search", debounced);
    const res = await apiFetch<{ orders: OrderRow[]; pagination: { pages: number } }>(
      `/api/admin/orders?${params}`,
    );
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

  const openEdit = (order: OrderRow) => {
    setSelected(order);
    setForm({
      status: order.status,
      startCount: order.startCount !== null ? String(order.startCount) : "",
      remains: order.remains !== null ? String(order.remains) : "",
      adminNote: order.adminNote ?? "",
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    const res = await apiFetch(`/api/admin/orders/${selected.id}`, {
      method: "PUT",
      body: JSON.stringify({
        status: form.status,
        startCount: form.startCount === "" ? null : Number(form.startCount),
        remains: form.remains === "" ? null : Number(form.remains),
        adminNote: form.adminNote || null,
      }),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setSelected(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Orders</h1>
        <p className="text-sm text-slate-400">
          Update delivery status — cancelling or failing an order auto-refunds the customer.
        </p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              className="pl-9"
              placeholder="Search link, customer name or email…"
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
          <EmptyState title="No orders found" />
        ) : (
          <>
            <Table head={["ID", "Customer", "Service", "Qty", "Amount", "Status", "Date", ""]}>
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-400">#{order.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-200">{order.userName}</p>
                    <p className="text-xs text-slate-500">{order.userEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-200">{order.serviceName}</p>
                    <p className="max-w-[200px] truncate text-xs text-blue-400">{order.link}</p>
                  </td>
                  <td className="px-4 py-3">{formatNumber(order.quantity)}</td>
                  <td className="px-4 py-3">{formatINR(order.totalCost)}</td>
                  <td className="px-4 py-3">
                    <Badge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(order)}>
                      Update
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Update order #${selected.id}` : "Update order"}
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <Label htmlFor="status">Status</Label>
            <Select
              id="status"
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="startCount">Start count</Label>
              <Input
                id="startCount"
                type="number"
                value={form.startCount}
                onChange={(e) => setForm((p) => ({ ...p, startCount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="remains">Remains</Label>
              <Input
                id="remains"
                type="number"
                value={form.remains}
                onChange={(e) => setForm((p) => ({ ...p, remains: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Admin note (visible to customer)</Label>
            <Textarea
              id="note"
              rows={3}
              value={form.adminNote}
              onChange={(e) => setForm((p) => ({ ...p, adminNote: e.target.value }))}
            />
          </div>
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Setting the status to <strong>cancelled</strong> or <strong>failed</strong> refunds the
            order amount to the customer wallet automatically (once per order).
          </p>
          <Button type="submit" className="w-full" loading={saving}>
            Save changes
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
