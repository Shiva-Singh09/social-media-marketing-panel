"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableSkeleton,
  Textarea,
} from "@/components/ui";
import { apiFetch, formatINR, formatNumber } from "@/lib/utils";

type ServiceRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  /** Cost basis per 1000 (what we pay the provider, or the manual rate). */
  pricePer1000: number;
  /** What USERS are charged per 1000 — pricePer1000 + panel margin. */
  userPricePer1000: number;
  minQuantity: number;
  maxQuantity: number;
  status: string;
};
type Category = { id: string; name: string };

const EMPTY = {
  categoryId: "",
  name: "",
  description: "",
  pricePer1000: 10,
  minQuantity: 100,
  maxQuantity: 10000,
  status: "active",
};

/** NaN-safe numeric parse for number inputs ("" / invalid → fallback). */
function toNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ services: ServiceRow[]; categories: Category[] }>(
      "/api/admin/services",
    );
    if (res.success && res.data) {
      setServices(res.data.services);
      setCategories(res.data.categories);
    }
    setLoading(false);
  }, []);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, categoryId: categories[0]?.id ?? "" });
    setOpen(true);
  };

  const openEdit = (service: ServiceRow) => {
    setEditing(service.id);
    setForm({
      categoryId: service.categoryId,
      name: service.name,
      description: service.description ?? "",
      pricePer1000: toNumber(String(service.pricePer1000), 0),
      minQuantity: toNumber(String(service.minQuantity), 0),
      maxQuantity: toNumber(String(service.maxQuantity), 0),
      status: service.status,
    });
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch(editing ? `/api/admin/services/${editing}` : "/api/admin/services", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setOpen(false);
    await load();
  };

  const remove = async (id: string) => {
    const res = await apiFetch(`/api/admin/services/${id}`, { method: "DELETE" });
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await load();
  };

  const visible = filter === "all" ? services : services.filter((s) => String(s.categoryId) === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Services</h1>
          <p className="text-sm text-slate-400">Pricing, limits and availability.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add service
        </Button>
      </div>

      <Card>
        <div className="mb-4 max-w-xs">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </Select>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState title="No services" action={<Button size="sm" onClick={openCreate}>Add one</Button>} />
        ) : (
          <Table head={["#", "Category", "Service", "Cost/1k", "User pays/1k", "Min", "Max", "Status", ""]}>
            {visible.map((service) => (
              <tr key={service.id} className="hover:bg-slate-900/50">
                <td className="px-4 py-3 text-slate-400">{service.id}</td>
                <td className="px-4 py-3 text-slate-300">{service.categoryName}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-100">{service.name}</p>
                  <p className="max-w-[280px] truncate text-xs text-slate-500">
                    {service.description ?? "—"}
                  </p>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {formatINR(service.pricePer1000)}
                </td>
                <td className="px-4 py-3 font-semibold text-emerald-300">
                  {formatINR(service.userPricePer1000)}
                </td>
                <td className="px-4 py-3">{formatNumber(service.minQuantity)}</td>
                <td className="px-4 py-3">{formatNumber(service.maxQuantity)}</td>
                <td className="px-4 py-3">
                  <Badge status={service.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(service)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(service.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Edit service" : "New service"}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select
                id="category"
                value={form.categoryId}
                onChange={(e) => setForm((p) => ({ ...p, categoryId: e.target.value }))}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
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
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="name">Service name</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="IG Followers Premium"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="price">Cost / 1000 (₹)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                required
                value={form.pricePer1000}
                onChange={(e) => setForm((p) => ({ ...p, pricePer1000: toNumber(e.target.value, p.pricePer1000) }))}
              />
              <p className="mt-1 text-[11px] leading-tight text-slate-500">
                Users are charged this +30% margin. Provider-synced services use the provider&apos;s
                rate instead — re-run “Sync from provider” to refresh.
              </p>
            </div>
            <div>
              <Label htmlFor="min">Min quantity</Label>
              <Input
                id="min"
                type="number"
                min="0"
                required
                value={form.minQuantity}
                onChange={(e) => setForm((p) => ({ ...p, minQuantity: toNumber(e.target.value, p.minQuantity) }))}
              />
            </div>
            <div>
              <Label htmlFor="max">Max quantity</Label>
              <Input
                id="max"
                type="number"
                min="0"
                required
                value={form.maxQuantity}
                onChange={(e) => setForm((p) => ({ ...p, maxQuantity: toNumber(e.target.value, p.maxQuantity) }))}
              />
            </div>
          </div>
          <Button type="submit" className="w-full" loading={saving}>
            {editing ? "Update service" : "Create service"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}