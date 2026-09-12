"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  Pagination,
  Table,
  TableSkeleton,
} from "@/components/ui";
import { PaymentButton } from "@/components/PaymentButton";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, formatDate, formatINR } from "@/lib/utils";

type Txn = {
  id: number;
  type: string;
  amount: string;
  description: string | null;
  paymentStatus: string;
  razorpayPaymentId: string | null;
  createdAt: string;
};

const PRESETS = [100, 250, 500, 1000, 2500, 5000];

export default function AddFundsPage() {
  const { user, settings, refresh } = useAuth();
  const min = settings?.minCreditAmount ?? 50;
  const [amount, setAmount] = useState<string>("500");
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ transactions: Txn[]; pagination: { pages: number } }>(
      `/api/payment/history?page=${page}&limit=8`,
    );
    if (res.success && res.data) {
      setTransactions(res.data.transactions);
      setPages(res.data.pagination.pages);
    }
    setLoading(false);
  }, [page]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const numericAmount = Number.parseFloat(amount || "0") || 0;
  const invalid = numericAmount < min;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Add funds</h1>
        <p className="text-sm text-slate-400">
          Top up your wallet securely with Razorpay — UPI, cards, netbanking &amp; wallets.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Choose an amount"
            subtitle={`Minimum top-up is ${formatINR(min)}`}
            action={
              <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-300">
                Balance {formatINR(user?.creditBalance ?? 0)}
              </span>
            }
          />

          <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setAmount(String(preset))}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  Number(amount) === preset
                    ? "border-blue-500 bg-blue-500/15 text-white"
                    : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-600"
                }`}
              >
                ₹{preset}
              </button>
            ))}
          </div>

          <div className="mb-4">
            <Label htmlFor="amount">Custom amount (INR)</Label>
            <Input
              id="amount"
              type="number"
              min={min}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {invalid ? (
              <p className="mt-1 text-xs text-red-400">Minimum amount is {formatINR(min)}</p>
            ) : null}
          </div>

          <PaymentButton
            amount={numericAmount}
            disabled={invalid}
            onSuccess={async () => {
              await refresh();
              setPage(1);
              await load();
            }}
          />

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Every payment is verified server-side with an HMAC SHA-256 signature check before
              credits are added. A Razorpay webhook acts as a second safety net.
            </span>
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Why top up?" />
          <ul className="space-y-3 text-sm text-slate-400">
            {[
              "Instant order placement — no payment step per order.",
              "Automatic refunds land back in your wallet.",
              "Bulk discounts unlock at higher balances.",
            ].map((point) => (
              <li key={point} className="flex gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                {point}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Transaction history" subtitle="Credits and debits on your wallet" />
        {loading ? (
          <TableSkeleton rows={5} />
        ) : transactions.length === 0 ? (
          <EmptyState title="No transactions yet" description="Your top-ups will appear here." />
        ) : (
          <>
            <Table head={["ID", "Type", "Amount", "Description", "Status", "Date"]}>
              {transactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-400">#{txn.id}</td>
                  <td className="px-4 py-3">
                    <Badge status={txn.type} />
                  </td>
                  <td
                    className={`px-4 py-3 font-semibold ${
                      txn.type === "credit" ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {txn.type === "credit" ? "+" : "−"}
                    {formatINR(txn.amount)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{txn.description ?? "—"}</td>
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

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => void load()}>
          Refresh history
        </Button>
      </div>
    </div>
  );
}
