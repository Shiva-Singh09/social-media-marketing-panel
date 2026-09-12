"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Save } from "lucide-react";
import { Button, Card, CardHeader, Input, Label, Skeleton, Textarea } from "@/components/ui";
import ProviderSyncCard from "@/components/smm/ProviderSyncCard";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/utils";

type SettingsPayload = {
  settings: {
    siteName: string;
    siteLogo: string | null;
    minCreditAmount: string;
    defaultMarkupPercent?: number;
    announcementText: string;
    supportEmail: string | null;
    maintenanceMode: boolean;
  };
  integrations: { razorpay: boolean; google: boolean; smtp: boolean };
};

/** NaN-safe numeric parse for number inputs ("" / invalid → fallback). */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function AdminSettingsPage() {
  const { refresh } = useAuth();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    siteName: "",
    siteLogo: "",
    minCreditAmount: 50,
    defaultMarkupPercent: 30,
    announcementText: "",
    supportEmail: "",
    maintenanceMode: false,
  });

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<SettingsPayload>("/api/admin/settings");
      if (res.success && res.data) {
        setData(res.data);
        setForm({
          siteName: res.data.settings.siteName,
          siteLogo: res.data.settings.siteLogo ?? "",
          minCreditAmount: toNumber(res.data.settings.minCreditAmount, 50),
          defaultMarkupPercent: toNumber(res.data.settings.defaultMarkupPercent, 30),
          announcementText: res.data.settings.announcementText ?? "",
          supportEmail: res.data.settings.supportEmail ?? "",
          maintenanceMode: res.data.settings.maintenanceMode,
        });
      }
      setLoading(false);
    })();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch<{ servicesUpdated?: number }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(
      res.data?.servicesUpdated
        ? `${res.message} — margin applied to ${res.data.servicesUpdated} service(s)`
        : res.message,
    );
    await refresh();
  };

  if (loading) return <Skeleton className="h-96 w-full" />;

  const integrations = [
    {
      name: "Razorpay payments",
      active: data?.integrations.razorpay,
      env: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET",
      fallback: "Demo checkout mode is active — payments are simulated and signed locally.",
    },
    {
      name: "Google OAuth",
      active: data?.integrations.google,
      env: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET",
      fallback: "Google sign-in button returns an error until credentials are set.",
    },
    {
      name: "SMTP email",
      active: data?.integrations.smtp,
      env: "SMTP_HOST / SMTP_USER / SMTP_PASS",
      fallback: "Password-reset links are returned in the API response instead of emailed.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Site settings</h1>
        <p className="text-sm text-slate-400">Branding, wallet rules and integrations.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="General" />
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="siteName">Site name</Label>
                <Input
                  id="siteName"
                  required
                  value={form.siteName}
                  onChange={(e) => setForm((p) => ({ ...p, siteName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="minCreditAmount">Minimum top-up (₹)</Label>
                <Input
                  id="minCreditAmount"
                  type="number"
                  min={1}
                  required
                  value={form.minCreditAmount}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      minCreditAmount: toNumber(e.target.value, p.minCreditAmount),
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="defaultMarkupPercent">Profit margin (%)</Label>
                <Input
                  id="defaultMarkupPercent"
                  type="number"
                  min={0}
                  max={500}
                  step="0.5"
                  required
                  value={form.defaultMarkupPercent}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      defaultMarkupPercent: toNumber(e.target.value, p.defaultMarkupPercent),
                    }))
                  }
                />
                <p className="mt-1 text-[11px] leading-tight text-slate-500">
                  Users pay provider cost + this %. Saving re-prices every service instantly.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="siteLogo">Logo URL</Label>
                <Input
                  id="siteLogo"
                  value={form.siteLogo}
                  onChange={(e) => setForm((p) => ({ ...p, siteLogo: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label htmlFor="supportEmail">Support email</Label>
                <Input
                  id="supportEmail"
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm((p) => ({ ...p, supportEmail: e.target.value }))}
                  placeholder="support@yourpanel.com"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="announcementText">Announcement banner</Label>
              <Textarea
                id="announcementText"
                rows={2}
                value={form.announcementText}
                onChange={(e) => setForm((p) => ({ ...p, announcementText: e.target.value }))}
                placeholder="Welcome! Add funds to get started."
              />
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-500"
                checked={form.maintenanceMode}
                onChange={(e) => setForm((p) => ({ ...p, maintenanceMode: e.target.checked }))}
              />
              Maintenance mode (show a notice to customers)
            </label>
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" /> Save settings
            </Button>
          </form>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Integrations" subtitle="Configured through environment variables" />
          <ul className="space-y-4 text-sm">
            {integrations.map((item) => (
              <li key={item.name} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{item.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      item.active
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {item.active ? "Live" : "Not configured"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-500">{item.env}</p>
                {!item.active ? (
                  <p className="mt-1 text-xs text-slate-400">{item.fallback}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Refresh services & prices from the SMM provider on demand — keeps the
          catalogue and every user-facing price in lockstep with upstream
          changes using the profit margin configured above. */}
      <ProviderSyncCard />
    </div>
  );
}
