"use client";

/**
 * AccountsManager — connect / pause / resume / disconnect social accounts.
 *
 * Demonstrates calling the SMM APIs from React 19 with the shared `apiFetch`
 * helper, which automatically:
 *   - attaches the double-submit CSRF header (`x-csrf-token`) on mutations,
 *   - sends the httpOnly JWT session cookie (`credentials: "include"`).
 * For external API clients (Postman / Thunder Client) send
 * `Authorization: Bearer <jwt>` instead — see README_SMM_INTEGRATION.md.
 */

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link2, Pause, Play, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  Select,
  TableSkeleton,
} from "@/components/ui";
import { apiFetch } from "@/lib/utils";

export type SocialAccount = {
  id: string;
  platform: string;
  handle: string;
  externalId: string | null;
  status: "active" | "paused";
  hasAccessToken: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
};

const PLATFORMS = [
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "twitter",
  "telegram",
  "other",
] as const;

export default function AccountsManager({ onChanged }: { onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Connect-form state
  const [platform, setPlatform] = useState<string>("instagram");
  const [handle, setHandle] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // NOTE: no synchronous setState here — the effect below calls this on
  // mount, and React's lint rules forbid sync setState inside effects.
  // `loading` starts as `true` from useState, which covers the first render.
  const load = useCallback(async () => {
    const res = await apiFetch<{ accounts: SocialAccount[] }>("/api/accounts/manage");
    if (res.success && res.data) setAccounts(res.data.accounts);
    else if (!res.success) toast.error(res.message);
    setLoading(false);
  }, []);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const res = await apiFetch<{ id: string }>("/api/accounts/manage", {
      method: "POST",
      body: JSON.stringify({
        platform,
        handle,
        ...(accessToken ? { accessToken } : {}),
      }),
    });
    setSubmitting(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setHandle("");
    setAccessToken("");
    await load();
    onChanged?.();
  };

  const toggleStatus = async (account: SocialAccount) => {
    const next = account.status === "active" ? "paused" : "active";
    const res = await apiFetch("/api/accounts/manage", {
      method: "PATCH",
      body: JSON.stringify({ id: account.id, status: next }),
    });
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await load();
  };

  const disconnect = async (account: SocialAccount) => {
    const res = await apiFetch(`/api/accounts/manage?id=${account.id}`, { method: "DELETE" });
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await load();
    onChanged?.();
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Connect an account"
          subtitle="Link a social profile to schedule posts and track its analytics."
        />
        <form onSubmit={connect} className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="platform">Platform</Label>
            <Select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="handle">Handle</Label>
            <Input
              id="handle"
              required
              minLength={2}
              maxLength={80}
              placeholder="@yourbrand"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="token">Access token (optional)</Label>
            <Input
              id="token"
              type="password"
              autoComplete="off"
              placeholder="OAuth token — encrypted at rest"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" loading={submitting}>
              <Link2 className="h-4 w-4" />
              Connect account
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Connected accounts" subtitle={`${accounts.length} linked profile(s)`} />
        {loading ? (
          <TableSkeleton rows={3} />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Connect your first social profile above to start scheduling."
          />
        ) : (
          <ul className="divide-y divide-slate-800">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    <span className="capitalize text-slate-400">{account.platform}</span>{" "}
                    {account.handle}
                  </p>
                  <p className="text-xs text-slate-500">
                    {account.hasAccessToken ? "Token stored (encrypted)" : "No token"} ·{" "}
                    <span className={account.status === "active" ? "text-emerald-400" : "text-amber-400"}>
                      {account.status}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggleStatus(account)}>
                    {account.status === "active" ? (
                      <>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => disconnect(account)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}