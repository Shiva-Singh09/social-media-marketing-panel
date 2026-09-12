"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { KeyRound } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { apiFetch } from "@/lib/utils";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    const res = await apiFetch("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: params.token, password }),
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    router.push("/login");
  };

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-white">Set a new password</h1>
      <p className="mt-1 text-sm text-slate-400">Choose a strong password of at least 8 characters.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          <KeyRound className="h-4 w-4" />
          Update password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
