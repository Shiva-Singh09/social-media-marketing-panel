"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquarePlus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Label,
  Table,
  TableSkeleton,
  Textarea,
} from "@/components/ui";
import { apiFetch, formatDate } from "@/lib/utils";

type Ticket = {
  id: number;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ tickets: Ticket[] }>("/api/support");
    if (res.success && res.data) setTickets(res.data.tickets);
    setLoading(false);
  }, []);

  // Data fetching on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch("/api/support", {
      method: "POST",
      body: JSON.stringify({ subject, message }),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setOpen(false);
    setSubject("");
    setMessage("");
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Support tickets</h1>
          <p className="text-sm text-slate-400">Average first response time: under 30 minutes.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <MessageSquarePlus className="h-4 w-4" /> New ticket
        </Button>
      </div>

      <Card>
        <CardHeader title="Your tickets" />
        {loading ? (
          <TableSkeleton rows={4} />
        ) : tickets.length === 0 ? (
          <EmptyState
            title="No tickets yet"
            description="Open a ticket if an order needs attention."
            action={<Button size="sm" onClick={() => setOpen(true)}>Create ticket</Button>}
          />
        ) : (
          <Table head={["ID", "Subject", "Replies", "Status", "Updated", ""]}>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-slate-900/50">
                <td className="px-4 py-3 text-slate-400">#{ticket.id}</td>
                <td className="px-4 py-3 text-slate-200">{ticket.subject}</td>
                <td className="px-4 py-3">{ticket.replyCount}</td>
                <td className="px-4 py-3">
                  <Badge status={ticket.status} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(ticket.updatedAt)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/support/${ticket.id}`}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Create support ticket">
        <form id="ticket-form" onSubmit={create} className="space-y-4">
          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              required
              minLength={4}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Order #12 not delivered"
            />
          </div>
          <div>
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              required
              minLength={10}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue in detail…"
            />
          </div>
          <Button type="submit" className="w-full" loading={saving}>
            Submit ticket
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
