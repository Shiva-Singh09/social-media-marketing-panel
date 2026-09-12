"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import { MailCheck } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { apiFetch } from "@/lib/utils";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ resetLink: string | null }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    setResetLink(res.data?.resetLink ?? null);
  };

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-white">Forgot password</h1>
      <p className="mt-1 text-sm text-slate-400">
        Enter your email and we&apos;ll send a reset link valid for 60 minutes.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          <MailCheck className="h-4 w-4" />
          Send reset link
        </Button>
      </form>

      {resetLink ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-semibold">SMTP not configured — dev reset link:</p>
          <Link href={resetLink.replace(/^https?:\/\/[^/]+/, "")} className="mt-1 block break-all underline">
            {resetLink}
          </Link>
        </div>
      ) : null}

      <p className="mt-6 text-center text-sm text-slate-400">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
