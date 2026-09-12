"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
} from "@/components/ui";
import { apiFetch, formatDate, formatINR, formatNumber } from "@/lib/utils";

type Detail = {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    status: string;
    creditBalance: string;
    createdAt: string;
    lastLogin: string | null;
    emailVerified: boolean;
  };
  orders: {
    id: number;
    status: string;
    quantity: number;
    totalCost: string;
    createdAt: string;
    serviceName: string;
  }[];
  transactions: {
    id: number;
    type: string;
    amount: string;
    description: string | null;
    paymentStatus: string;
    createdAt: string;
  }[];
  totals: { orders: number; spent: number };
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ name: "", role: "user", status: "active", adjustment: "", note: "" });

  const load = useCallback(async () => {
    const res = await apiFetch<Detail>(`/api/admin/users/${params.id}`);
    if (res.success && res.data) {
      setData(res.data);
      setForm((prev) => ({
        ...prev,
        name: res.data!.user.name,
        role: res.data!.user.role,
        status: res.data!.user.status,
      }));
    }
    setLoading(false);
  }, [params.id]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch(`/api/admin/users/${params.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: form.name,
        role: form.role,
        status: form.status,
        balanceAdjustment:
          form.adjustment && Number.isFinite(Number(form.adjustment))
            ? Number(form.adjustment)
            : undefined,
        adjustmentNote: form.note || undefined,
      }),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setForm((prev) => ({ ...prev, adjustment: "", note: "" }));
    await load();
  };

  const remove = async () => {
    const res = await apiFetch(`/api/admin/users/${params.id}`, { method: "DELETE" });
    if (!res.success) return toast.error(res.message);
    toast.success("User deleted");
    router.push("/admin/users");
  };

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!data) {
    return (
      <EmptyState
        title="User not found"
        action={
          <Link href="/admin/users">
            <Button size="sm">Back to users</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={data.user.name} subtitle={data.user.email} action={<Badge status={data.user.status} />} />
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select
                  id="role"
                  value={form.role}
                  onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="blocked">Blocked</option>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="adjustment">Balance adjustment (₹)</Label>
                <Input
                  id="adjustment"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 500 or -100"
                  value={form.adjustment}
                  onChange={(e) => setForm((p) => ({ ...p, adjustment: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="note">Adjustment note</Label>
                <Input
                  id="note"
                  placeholder="Manual top-up / correction"
                  value={form.note}
                  onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete user
              </Button>
            </div>
          </form>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Summary" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Balance</dt>
              <dd className="font-semibold text-emerald-300">{formatINR(data.user.creditBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Total orders</dt>
              <dd className="text-slate-200">{formatNumber(data.totals.orders)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Lifetime spend</dt>
              <dd className="text-slate-200">{formatINR(data.totals.spent)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Email verified</dt>
              <dd className="text-slate-200">{data.user.emailVerified ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Joined</dt>
              <dd className="text-slate-200">{formatDate(data.user.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Last login</dt>
              <dd className="text-slate-200">{formatDate(data.user.lastLogin)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders" />
          {data.orders.length === 0 ? (
            <p className="text-sm text-slate-500">No orders yet.</p>
          ) : (
            <Table head={["ID", "Service", "Cost", "Status"]}>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 text-slate-400">#{order.id}</td>
                  <td className="px-4 py-3 text-slate-200">{order.serviceName}</td>
                  <td className="px-4 py-3">{formatINR(order.totalCost)}</td>
                  <td className="px-4 py-3">
                    <Badge status={order.status} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent transactions" />
          {data.transactions.length === 0 ? (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <Table head={["ID", "Type", "Amount", "Status"]}>
              {data.transactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="px-4 py-3 text-slate-400">#{txn.id}</td>
                  <td className="px-4 py-3">
                    <Badge status={txn.type} />
                  </td>
                  <td className="px-4 py-3">{formatINR(txn.amount)}</td>
                  <td className="px-4 py-3">
                    <Badge status={txn.paymentStatus} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this user?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          This removes the account along with its orders, transactions and tickets. This action
          cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
