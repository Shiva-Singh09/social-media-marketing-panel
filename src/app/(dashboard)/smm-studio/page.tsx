"use client";

/**
 * SMM Studio — example page composing the three integration components:
 *   1. AccountsManager  (multi-account management)
 *   2. SchedulePostForm (post scheduling + boost)
 *   3. ScheduledPosts   (list / cancel queued posts)
 *   4. AnalyticsPanel   (likes / comments / reach trends)
 *
 * Route is session-gated via PROTECTED_PAGES in src/proxy.ts.
 */

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, TableSkeleton } from "@/components/ui";
import { apiFetch, formatDate } from "@/lib/utils";
import AccountsManager, { type SocialAccount } from "@/components/smm/AccountsManager";
import SchedulePostForm from "@/components/smm/SchedulePostForm";
import AnalyticsPanel from "@/components/smm/AnalyticsPanel";
import ServiceOrderForm from "@/components/smm/ServiceOrderForm";
import ProviderSyncCard from "@/components/smm/ProviderSyncCard";

type ScheduledPost = {
  id: string;
  accountHandle: string | null;
  platform: string;
  content: string;
  scheduledAt: string;
  status: string;
  smmOrderId: number | null;
  lastError: string | null;
};

function ScheduledPosts({ refreshToken }: { refreshToken: number }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);

  // No sync setState — `loading` initializes true and this runs in an effect.
  const load = useCallback(async () => {
    const res = await apiFetch<{ posts: ScheduledPost[] }>("/api/posts/schedule?limit=10");
    if (res.success && res.data) setPosts(res.data.posts);
    setLoading(false);
  }, []);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshToken]);

  const cancel = async (post: ScheduledPost) => {
    const res = await apiFetch(`/api/posts/schedule?id=${post.id}`, { method: "DELETE" });
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await load();
  };

  if (loading) return <TableSkeleton rows={3} />;
  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nothing scheduled"
        description="Scheduled posts and their boost orders will appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-800">
      {posts.map((post) => (
        <li key={post.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-200">{post.content}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="capitalize">{post.platform}</span>
              {post.accountHandle ? <span>· {post.accountHandle}</span> : null}
              <span>· {formatDate(post.scheduledAt)}</span>
              {post.smmOrderId ? <span>· order #{post.smmOrderId}</span> : null}
              {post.lastError ? <span className="text-red-400">· {post.lastError}</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={post.status} />
            {post.status === "scheduled" ? (
              <Button size="sm" variant="ghost" onClick={() => cancel(post)}>
                <XCircle className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function SmmStudioPage() {
  // Bumped whenever accounts/posts change so sibling lists reload.
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = useCallback(() => setRefreshToken((n) => n + 1), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SMM Studio</h1>
        <p className="text-sm text-slate-400">
          Manage connected accounts, schedule posts with engagement boosts, and track analytics.
        </p>
      </div>

      <AnalyticsPanel />

      <ProviderSyncCard />

      <ServiceOrderForm />

      <SchedulePostForm onScheduled={bump} />

      <Card>
        <CardHeader title="Scheduled & recent posts" subtitle="Newest first · cancel before go-live" />
        <ScheduledPosts refreshToken={refreshToken} />
      </Card>

      <AccountsManager onChanged={bump} />
    </div>
  );
}