"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { MailWarning } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { apiFetch } from "@/lib/utils";

/**
 * Blocks access to the dashboard/admin content for accounts that haven't
 * verified their email yet (server-side, `requireUser()` rejects every API
 * call for these accounts with a 403 — this is the matching UI so the user
 * isn't just staring at empty/broken pages).
 */
export function VerifyEmailGate({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const resend = async () => {
    setSending(true);
    const res = await apiFetch<{ verifyLink: string | null }>("/api/auth/resend-verification", {
      method: "POST",
    });
    setSending(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setLink(res.data?.verifyLink ?? null);
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
          <MailWarning className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-white">Verify your email</h1>
        <p className="mt-2 text-sm text-slate-400">
          We sent a verification link to <span className="text-slate-200">{email}</span>. Please
          confirm your address to place orders and add funds.
        </p>
        <Button className="mt-5 w-full" onClick={resend} loading={sending}>
          Resend verification email
        </Button>
        {link ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="font-semibold">SMTP not configured — dev verify link:</p>
            <a href={link.replace(/^https?:\/\/[^/]+/, "")} className="mt-1 block break-all underline">
              {link}
            </a>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
