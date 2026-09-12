"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Send } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Select,
  Table,
  TableSkeleton,
  Textarea,
} from "@/components/ui";
import { apiFetch, formatDate } from "@/lib/utils";

type Ticket = {
  id: number;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  userName: string;
  userEmail: string;
  replyCount: number;
};
type Reply = { id: number; message: string; isAdmin: boolean; createdAt: string };

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [active, setActive] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ tickets: Ticket[] }>(
      `/api/admin/support?status=${statusFilter}`,
    );
    if (res.success && res.data) setTickets(res.data.tickets);
    setLoading(false);
  }, [statusFilter]);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openTicket = async (ticket: Ticket) => {
    setActive(ticket);
    setMessage("");
    const res = await apiFetch<{ ticket: Ticket; replies: Reply[] }>(
      `/api/admin/support/${ticket.id}`,
    );
    if (res.success && res.data) {
      setActive(res.data.ticket);
      setReplies(res.data.replies);
    }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active) return;
    setSending(true);
    const res = await apiFetch(`/api/admin/support/${active.id}`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    setSending(false);
    if (!res.success) return toast.error(res.message);
    toast.success("Reply sent");
    setMessage("");
    await openTicket(active);
    await load();
  };

  const setStatus = async (ticket: Ticket, status: string) => {
    const res = await apiFetch(`/api/admin/support/${ticket.id}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    if (!res.success) return toast.error(res.message);
    toast.success("Ticket updated");
    if (active?.id === ticket.id) setActive({ ...active, status });
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Support inbox</h1>
        <p className="text-sm text-slate-400">Reply to customers and close resolved tickets.</p>
      </div>

      <Card>
        <div className="mb-4 max-w-xs">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All tickets</option>
            <option value="open">Open</option>
            <option value="replied">Replied</option>
            <option value="closed">Closed</option>
          </Select>
        </div>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : tickets.length === 0 ? (
          <EmptyState title="Inbox zero" description="No tickets match this filter." />
        ) : (
          <Table head={["ID", "Customer", "Subject", "Replies", "Status", "Updated", ""]}>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-slate-900/50">
                <td className="px-4 py-3 text-slate-400">#{ticket.id}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-200">{ticket.userName}</p>
                  <p className="text-xs text-slate-500">{ticket.userEmail}</p>
                </td>
                <td className="px-4 py-3 text-slate-200">{ticket.subject}</td>
                <td className="px-4 py-3">{ticket.replyCount}</td>
                <td className="px-4 py-3">
                  <Badge status={ticket.status} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(ticket.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void openTicket(ticket)}>
                      Open
                    </Button>
                    {ticket.status !== "closed" ? (
                      <Button size="sm" variant="outline" onClick={() => void setStatus(ticket, "closed")}>
                        Close
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active ? `#${active.id} · ${active.subject}` : "Ticket"}
      >
        {active ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {active.userName} · {active.userEmail}
              </p>
              <Badge status={active.status} />
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="mb-1 text-xs font-semibold text-slate-400">
                Customer · {formatDate(active.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{active.message}</p>
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
                  {reply.isAdmin ? "Support" : "Customer"} · {formatDate(reply.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-200">{reply.message}</p>
              </div>
            ))}

            <form onSubmit={sendReply} className="space-y-3">
              <Textarea
                rows={4}
                required
                placeholder="Write a reply…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void setStatus(active, active.status === "closed" ? "open" : "closed")}
                >
                  {active.status === "closed" ? "Reopen ticket" : "Close ticket"}
                </Button>
                <Button type="submit" loading={sending}>
                  <Send className="h-4 w-4" /> Send reply
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
