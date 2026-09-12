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
} from "@/components/ui";
import { apiFetch, formatDate } from "@/lib/utils";

type Category = {
  id: string;
  name: string;
  platformKey: string | null;
  icon: string | null;
  status: string;
  sortOrder: number;
  serviceCount: number;
  createdAt: string;
};

const EMPTY = { name: "", platformKey: "", icon: "", status: "active", sortOrder: 0 };

/** NaN-safe numeric parse for number inputs ("" / invalid → fallback). */
function toNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ categories: Category[] }>("/api/admin/categories");
    if (res.success && res.data) setCategories(res.data.categories);
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
    setForm({ ...EMPTY, sortOrder: categories.length + 1 });
    setOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category.id);
    setForm({
      name: category.name,
      platformKey: category.platformKey ?? "",
      icon: category.icon ?? "",
      status: category.status,
      sortOrder: category.sortOrder,
    });
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch(
      editing ? `/api/admin/categories/${editing}` : "/api/admin/categories",
      { method: editing ? "PUT" : "POST", body: JSON.stringify(form) },
    );
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setOpen(false);
    await load();
  };

  const remove = async (id: string) => {
    const res = await apiFetch(`/api/admin/categories/${id}`, { method: "DELETE" });
    if (!res.success) return toast.error(res.message);
    toast.success("Category deleted");
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Categories</h1>
          <p className="text-sm text-slate-400">Platform groups shown on the order page.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add category
        </Button>
      </div>

      <Card>
        {loading ? (
          <TableSkeleton rows={5} />
        ) : categories.length === 0 ? (
          <EmptyState title="No categories" action={<Button size="sm" onClick={openCreate}>Add one</Button>} />
        ) : (
          <Table head={["#", "Name", "Icon", "Services", "Order", "Status", "Created", ""]}>
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-slate-900/50">
                <td className="px-4 py-3 text-slate-400">{category.id}</td>
                <td className="px-4 py-3 font-medium text-slate-100">
                  {category.name}
                  {category.platformKey ? (
                    <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {category.platformKey}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-400">{category.icon ?? "—"}</td>
                <td className="px-4 py-3">{category.serviceCount}</td>
                <td className="px-4 py-3">{category.sortOrder}</td>
                <td className="px-4 py-3">
                  <Badge status={category.status} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(category.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(category)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(category.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Edit category" : "New category"}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Instagram"
            />
          </div>
          <div>
            <Label htmlFor="platformKey">Platform key (used for link validation)</Label>
            <Input
              id="platformKey"
              value={form.platformKey}
              onChange={(e) => setForm((p) => ({ ...p, platformKey: e.target.value.toLowerCase() }))}
              placeholder="instagram"
            />
            <p className="mt-1 text-xs text-slate-500">
              Stable slug (lowercase, no spaces) used to restrict order links to this platform&apos;s
              domains. Leave blank to allow any link for this category.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="icon">Icon key</Label>
              <Input
                id="icon"
                value={form.icon}
                onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                placeholder="instagram"
              />
            </div>
            <div>
              <Label htmlFor="sortOrder">Sort order</Label>
              <Input
                id="sortOrder"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((p) => ({ ...p, sortOrder: toNumber(e.target.value, p.sortOrder) }))
                }
              />
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
          <Button type="submit" className="w-full" loading={saving}>
            {editing ? "Update category" : "Create category"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
