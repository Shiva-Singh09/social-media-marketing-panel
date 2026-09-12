"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Pagination,
  Table,
  TableSkeleton,
} from "@/components/ui";
import { apiFetch, formatDate, formatINR } from "@/lib/utils";

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  creditBalance: string;
  createdAt: string;
  lastLogin: string | null;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "12" });
    if (debounced) params.set("search", debounced);
    const res = await apiFetch<{ users: UserRow[]; pagination: { pages: number } }>(
      `/api/admin/users?${params}`,
    );
    if (res.success && res.data) {
      setUsers(res.data.users);
      setPages(res.data.pagination.pages);
    }
    setLoading(false);
  }, [page, debounced]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggleStatus = async (user: UserRow) => {
    const next = user.status === "active" ? "blocked" : "active";
    const res = await apiFetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: next }),
    });
    if (!res.success) return toast.error(res.message);
    toast.success(`User ${next === "blocked" ? "blocked" : "unblocked"}`);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-sm text-slate-400">Manage balances, roles and access.</p>
      </div>

      <Card>
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : users.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <>
            <Table head={["ID", "Name", "Email", "Balance", "Role", "Status", "Joined", ""]}>
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-400">#{user.id}</td>
                  <td className="px-4 py-3 text-slate-200">{user.name}</td>
                  <td className="px-4 py-3 text-slate-400">{user.email}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-300">
                    {formatINR(user.creditBalance)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={user.role === "admin" ? "active" : "inactive"} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={user.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/admin/users/${user.id}`}>
                        <Button size="sm" variant="secondary">
                          Manage
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant={user.status === "active" ? "danger" : "success"}
                        onClick={() => void toggleStatus(user)}
                      >
                        {user.status === "active" ? "Block" : "Unblock"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pages={pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
