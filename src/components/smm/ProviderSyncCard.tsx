"use client";

/**
 * ProviderSyncCard — admin-only control that imports the SMM provider's
 * service catalogue (POST /api/admin/provider/sync).
 *
 * Why it exists: /api/services/order requires each local service to carry a
 * `providerServiceId` + `providerCostPer1000`. Services created before the
 * credit system have no mapping, so ordering answers 409 until an admin runs
 * this sync once. Hidden for non-admin users.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { CloudDownload } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/utils";

type SyncResult = {
  fetched: number;
  servicesUpserted: number;
  categoriesCreated: number;
  skippedCount: number;
  prunedCount: number;
  truncated: boolean;
};

export default function ProviderSyncCard() {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  if (user?.role !== "admin") return null;

  const sync = async () => {
    setSyncing(true);
    const res = await apiFetch<SyncResult>("/api/admin/provider/sync", { method: "POST" });
    setSyncing(false);
    if (!res.success || !res.data) return toast.error(res.message);
    setResult(res.data);
    toast.success(res.message);
  };

  return (
    <Card>
      <CardHeader
        title="Provider services & prices"
        subtitle="Refresh the catalogue and re-price everything from the provider using your configured profit margin (Admin → Settings)."
        action={
          <Button size="sm" onClick={sync} loading={syncing}>
            <CloudDownload className="h-3.5 w-3.5" />
            Refresh services &amp; prices
          </Button>
        }
      />
      {result ? (
        <p className="text-xs text-slate-400">
          Fetched <span className="text-slate-200">{result.fetched}</span> · upserted{" "}
          <span className="text-emerald-300">{result.servicesUpserted}</span> services ·{" "}
          {result.categoriesCreated} new categories
          {result.prunedCount > 0 ? ` · ${result.prunedCount} discontinued hidden` : ""}
          {result.skippedCount > 0 ? ` · ${result.skippedCount} skipped` : ""}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Requires <code className="text-slate-300">SMM_API_KEY</code> in the environment.
          Every service is priced at provider cost + your profit margin from Settings.
        </p>
      )}
    </Card>
  );
}