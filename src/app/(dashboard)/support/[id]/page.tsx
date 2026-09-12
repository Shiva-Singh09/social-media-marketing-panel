"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Send } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, Textarea } from "@/components/ui";
import { apiFetch, formatDate } from "@/lib/utils";

type Ticket = {
  id: number;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
};
type Reply = { id: number; message: string; isAdmin: boolean; createdAt: string };

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ ticket: Ticket; replies: Reply[] }>(`/api/support/${params.id}`);
    if (res.success && res.data) {
      setTicket(res.data.ticket);
      setReplies(res.data.replies);
    }
    setLoading(false);
  }, [params.id]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    const res = await apiFetch(`/api/support/${params.id}/reply`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    setSending(false);
    if (!res.success) return toast.error(res.message);
    setMessage("");
    await load();
    toast.success("Reply sent");
  };

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!ticket) {
    return (
      <EmptyState
        title="Ticket not found"
        action={
          <Link href="/support">
            <Button size="sm">Back to support</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/support" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to tickets
      </Link>

      <Card>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white">{ticket.subject}</h1>
            <p className="text-xs text-slate-500">
              Ticket #{ticket.id} · opened {formatDate(ticket.createdAt)}
            </p>
          </div>
          <Badge status={ticket.status} />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="mb-1 text-xs font-semibold text-slate-400">You</p>
            <p className="whitespace-pre-wrap text-sm text-slate-200">{ticket.message}</p>
          </div>

          {replies.map((reply) => (
            <div
              key={reply.id}
              className={`rounded-2xl border p-4 ${
                reply.isAdmin
                  ? "border-blue-500/30 bg-blue-500/10"
                  : "border-slate-800 bg-slate-950/60"
              }`}
            >
              <p className="mb-1 text-xs font-semibold text-slate-400">
                {reply.isAdmin ? "Support team" : "You"} · {formatDate(reply.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{reply.message}</p>
            </div>
          ))}
        </div>

        {ticket.status === "closed" ? (
          <p className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-center text-sm text-slate-400">
            This ticket is closed. Create a new ticket if you need more help.
          </p>
        ) : (
          <form onSubmit={send} className="mt-6 space-y-3">
            <Textarea
              rows={4}
              required
              placeholder="Type your reply…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" loading={sending}>
                <Send className="h-4 w-4" /> Send reply
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
