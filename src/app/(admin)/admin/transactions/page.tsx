"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Pagination,
  Select,
  Table,
  TableSkeleton,
} from "@/components/ui";
import { StatsCard } from "@/components/StatsCard";
import { apiFetch, formatDate, formatINR } from "@/lib/utils";

type Txn = {
  id: number;
  type: string;
  amount: string;
  description: string | null;
  paymentStatus: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  userName: string;
  userEmail: string;
};

export default function AdminTransactionsPage() {
  const [rows, setRows] = useState<Txn[]>([]);
  const [totals, setTotals] = useState({ credited: 0, debited: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "12" });
    if (type !== "all") params.set("type", type);
    if (debounced) params.set("search", debounced);
    const res = await apiFetch<{
      transactions: Txn[];
      totals: { credited: number; debited: number };
      pagination: { pages: number };
    }>(`/api/admin/transactions?${params}`);
    if (res.success && res.data) {
      setRows(res.data.transactions);
      setTotals(res.data.totals);
      setPages(res.data.pagination.pages);
    }
    setLoading(false);
  }, [page, type, debounced]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Transactions</h1>
        <p className="text-sm text-slate-400">Every credit, debit and payment attempt is logged.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatsCard label="Total credited" value={totals.credited} prefix="₹" decimals={2} accent="emerald" />
        <StatsCard label="Total debited" value={totals.debited} prefix="₹" decimals={2} accent="rose" />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              className="pl-9"
              placeholder="Search user or description…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
          <Select
            className="w-44"
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
          >
            <option value="all">All types</option>
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </Select>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState title="No transactions found" />
        ) : (
          <>
            <Table head={["ID", "User", "Type", "Amount", "Description", "Razorpay", "Status", "Date"]}>
              {rows.map((txn) => (
                <tr key={txn.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-400">#{txn.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-200">{txn.userName}</p>
                    <p className="text-xs text-slate-500">{txn.userEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={txn.type} />
                  </td>
                  <td
                    className={`px-4 py-3 font-semibold ${
                      txn.type === "credit" ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {formatINR(txn.amount)}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-slate-300">
                    {txn.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {txn.razorpayPaymentId ?? txn.razorpayOrderId ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={txn.paymentStatus} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(txn.createdAt)}</td>
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
