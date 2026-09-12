"use client";

/**
 * AnalyticsPanel — fetches GET /api/analytics/fetch and renders:
 *   - summary stat cards (likes / comments / reach / impressions),
 *   - a lightweight CSS bar chart of the daily trend,
 *   - the latest snapshot per connected account,
 *   - live provider delivery stats when a boosted post id is inspected.
 *
 * Data can be populated via POST /api/analytics/fetch (manual entry or a
 * platform webhook) — see README_SMM_INTEGRATION.md for example payloads.
 */

import { useCallback, useEffect, useState } from "react";
import { Heart, MessageCircle, Eye, Users, RefreshCw } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Input, Label, Select } from "@/components/ui";
import { apiFetch, formatNumber } from "@/lib/utils";

type AnalyticsResponse = {
  window: { days: number; since: string; until: string };
  summary: {
    likes: number;
    comments: number;
    reach: number;
    impressions: number;
    shares: number;
    snapshots: number;
  };
  series: { date: string; likes: number; comments: number; reach: number; impressions: number }[];
  accounts: {
    accountId: string | null;
    handle: string;
    platform: string;
    latest: {
      likes: number;
      comments: number;
      reach: number;
      followers: number | null;
      capturedAt: string;
    };
  }[];
  post: {
    id: string;
    platform: string;
    status: string;
    smmOrderId: number | null;
    lastError: string | null;
    live: {
      providerStatus?: string;
      startCount?: number | null;
      remains?: number | null;
      quantity?: number | null;
      delivered?: number | null;
      error?: string;
    } | null;
  } | null;
};

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

export default function AnalyticsPanel() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Separate flag for the Refresh button so `load` itself never calls
  // setState synchronously (required by the react-hooks lint rules when
  // invoked from an effect on mount).
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState("30");
  const [postId, setPostId] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days });
    if (postId.trim()) params.set("postId", postId.trim());
    const res = await apiFetch<AnalyticsResponse>(`/api/analytics/fetch?${params}`);
    if (res.success && res.data) setData(res.data);
    setLoading(false);
  }, [days, postId]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Manual refresh — setState in an event handler is fine. */
  const refresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  const maxReach = Math.max(1, ...(data?.series.map((d) => d.reach) ?? [1]));

  return (
    <div className="space-y-5">
      {/* ---- Filters ---- */}
      <Card>
        <CardHeader
          title="Analytics"
          subtitle="Aggregated engagement metrics for your connected accounts."
          action={
            <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="range">Lookback window</Label>
            <Select id="range" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="post">Inspect boosted post (optional)</Label>
            <Input
              id="post"
              placeholder="Scheduled post ObjectId"
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* ---- Summary cards ---- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Heart className="h-4 w-4 text-pink-400" />} label="Likes" value={formatNumber(data?.summary.likes ?? 0)} />
        <StatCard icon={<MessageCircle className="h-4 w-4 text-sky-400" />} label="Comments" value={formatNumber(data?.summary.comments ?? 0)} />
        <StatCard icon={<Eye className="h-4 w-4 text-violet-400" />} label="Reach" value={formatNumber(data?.summary.reach ?? 0)} />
        <StatCard icon={<Users className="h-4 w-4 text-emerald-400" />} label="Impressions" value={formatNumber(data?.summary.impressions ?? 0)} />
      </div>

      {/* ---- Daily trend (pure CSS bars — no chart lib needed) ---- */}
      <Card>
        <CardHeader title="Daily reach trend" subtitle={`Last ${data?.window.days ?? days} day(s)`} />
        {!data || data.series.length === 0 ? (
          <EmptyState
            title="No snapshots yet"
            description="Record metrics via POST /api/analytics/fetch to build your trend."
          />
        ) : (
          <div className="flex h-40 items-end gap-1.5">
            {data.series.map((point) => (
              <div key={point.date} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-blue-600 to-violet-500 transition-all group-hover:from-blue-500"
                  style={{ height: `${Math.max(4, (point.reach / maxReach) * 150)}px` }}
                />
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 shadow group-hover:block">
                  {point.date}: {formatNumber(point.reach)} reach
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---- Live boost delivery (when inspecting a post) ---- */}
      {data?.post ? (
        <Card>
          <CardHeader
            title="Live boost status"
            subtitle={data.post.smmOrderId ? `Provider order #${data.post.smmOrderId}` : "No boost order placed yet"}
          />
          {data.post.live?.error ? (
            <p className="text-sm text-amber-400">{data.post.live.error}</p>
          ) : data.post.live ? (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">Provider status</dt>
                <dd className="font-semibold capitalize text-slate-200">{data.post.live.providerStatus}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Delivered</dt>
                <dd className="font-semibold text-emerald-300">{formatNumber(data.post.live.delivered ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Remaining</dt>
                <dd className="font-semibold text-slate-200">{formatNumber(data.post.live.remains ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Start count</dt>
                <dd className="font-semibold text-slate-200">{formatNumber(data.post.live.startCount ?? 0)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Post status: <span className="capitalize">{data.post.status}</span>
              {data.post.lastError ? ` — ${data.post.lastError}` : ""}
            </p>
          )}
        </Card>
      ) : null}

      {/* ---- Per-account latest snapshot ---- */}
      {data && data.accounts.length > 0 ? (
        <Card>
          <CardHeader title="Per-account snapshot" subtitle="Most recent recorded metrics" />
          <ul className="divide-y divide-slate-800">
            {data.accounts.map((account) => (
              <li key={String(account.accountId)} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-medium text-slate-200">
                  <span className="capitalize text-slate-500">{account.platform}</span> {account.handle}
                </span>
                <span className="flex gap-4 text-xs text-slate-400">
                  <span>❤️ {formatNumber(account.latest.likes)}</span>
                  <span>💬 {formatNumber(account.latest.comments)}</span>
                  <span>👁️ {formatNumber(account.latest.reach)}</span>
                  {account.latest.followers !== null ? (
                    <span>👥 {formatNumber(account.latest.followers)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}