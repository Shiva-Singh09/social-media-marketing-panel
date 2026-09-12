"use client";

/**
 * SchedulePostForm — schedule a post for a connected account, optionally with
 * a provider "boost" (an SMM order placed when the post goes live).
 *
 * Shows the two scheduling modes:
 *   - "Schedule"  → queued; POST /api/posts/process (cron) places the boost
 *                   once `scheduledAt` passes.
 *   - "Post now"  → boost order placed immediately via executeNow: true.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, Zap } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { apiFetch } from "@/lib/utils";
import type { SocialAccount } from "@/components/smm/AccountsManager";

type ScheduleResponse = {
  id: string;
  status: string;
  smmOrderId: number | null;
};

export default function SchedulePostForm({ onScheduled }: { onScheduled?: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");

  // Optional boost
  const [boostEnabled, setBoostEnabled] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [boostLink, setBoostLink] = useState("");
  const [quantity, setQuantity] = useState("");
  const [runs, setRuns] = useState("");
  const [interval, setInterval_] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load connected accounts so the user can pick a destination profile.
  useEffect(() => {
    void (async () => {
      const res = await apiFetch<{ accounts: SocialAccount[] }>("/api/accounts/manage");
      if (res.success && res.data) {
        const active = res.data.accounts.filter((a) => a.status === "active");
        setAccounts(active);
        if (active[0]) setAccountId(active[0].id);
      }
    })();
  }, []);

  /** Builds the JSON body and validates the drip-feed pairing client-side. */
  function buildBody(executeNow: boolean) {
    const hasRuns = runs.trim() !== "";
    const hasInterval = interval.trim() !== "";
    if (hasRuns !== hasInterval) {
      toast.error("Drip-feed needs both runs and interval");
      return null;
    }
    return {
      accountId,
      content,
      scheduledAt: new Date(scheduledAt).toISOString(),
      executeNow,
      ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
      ...(boostEnabled
        ? {
            boost: {
              serviceId: Number(serviceId),
              quantity: Number(quantity),
              ...(boostLink ? { link: boostLink } : {}),
              ...(hasRuns ? { runs: Number(runs), interval: Number(interval) } : {}),
            },
          }
        : {}),
    };
  }

  async function submit(executeNow: boolean) {
    if (!accountId) return toast.error("Connect an account first");
    if (!content.trim()) return toast.error("Write some content first");
    if (!scheduledAt) return toast.error("Pick a date & time");

    const body = buildBody(executeNow);
    if (!body) return;

    setSubmitting(true);
    const res = await apiFetch<ScheduleResponse>("/api/posts/schedule", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSubmitting(false);

    if (!res.success || !res.data) return toast.error(res.message);
    toast.success(
      res.data.smmOrderId
        ? `Published — provider order #${res.data.smmOrderId}`
        : res.message,
    );
    setContent("");
    onScheduled?.();
  }

  return (
    <Card>
      <CardHeader
        title="Schedule a post"
        subtitle="Queue content for a connected account, with optional engagement boost."
      />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="account">Publish to</Label>
            <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.length === 0 ? <option value="">No active accounts</option> : null}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform} · {a.handle}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="when">Date & time</Label>
            <Input
              id="when"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="content">Content</Label>
          <Textarea
            id="content"
            required
            rows={4}
            maxLength={2200}
            placeholder="What are you posting today? #hashtags welcome"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="media">Media URL (optional)</Label>
          <Input
            id="media"
            type="url"
            placeholder="https://cdn.example.com/reel.mp4"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
          />
        </div>

        {/* ---- Optional provider boost ---- */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-200">
            <input
              type="checkbox"
              checked={boostEnabled}
              onChange={(e) => setBoostEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900"
            />
            Add engagement boost (SMM order at go-live)
          </label>

          {boostEnabled ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="service">Provider service ID</Label>
                <Input
                  id="service"
                  type="number"
                  min={1}
                  required
                  placeholder="123"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Numeric id from the provider service list.
                </p>
              </div>
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  required
                  placeholder="1000"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="boostLink">Target link (optional)</Label>
                <Input
                  id="boostLink"
                  type="url"
                  placeholder="https://instagram.com/p/abc"
                  value={boostLink}
                  onChange={(e) => setBoostLink(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="runs">Drip-feed runs (optional)</Label>
                <Input
                  id="runs"
                  type="number"
                  min={1}
                  placeholder="5"
                  value={runs}
                  onChange={(e) => setRuns(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="interval">Interval in minutes</Label>
                <Input
                  id="interval"
                  type="number"
                  min={5}
                  max={1440}
                  placeholder="60"
                  value={interval}
                  onChange={(e) => setInterval_(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={submitting}>
            <CalendarClock className="h-4 w-4" />
            Schedule post
          </Button>
          <Button
            type="button"
            variant="success"
            loading={submitting}
            disabled={!boostEnabled}
            onClick={() => void submit(true)}
          >
            <Zap className="h-4 w-4" />
            Post now + boost
          </Button>
        </div>
      </form>
    </Card>
  );
}