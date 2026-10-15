"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LogIn } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/utils";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const error = params.get("error");
    if (error === "google_not_configured") {
      toast.error("Google login is not configured on this deployment");
    } else if (error === "google_failed") {
      toast.error("Google sign-in failed, please use email + password");
    } else if (error === "account_blocked") {
      toast.error("Your account has been blocked. Contact support.");
    }

    const verify = params.get("verify");
    if (verify === "success") {
      toast.success("Email verified — you can sign in now");
    } else if (verify === "invalid") {
      toast.error("That verification link is invalid or already used");
    }
  }, [params]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const res = await apiFetch<{ user: { role: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);

    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success("Welcome back!");
    const user = await refresh();
    const next = params.get("next");
    router.push(next ?? (user?.role === "admin" ? "/admin/dashboard" : "/dashboard"));
    router.refresh();
  };

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-white">Sign in</h1>
      <p className="mt-1 text-sm text-slate-400">Access your panel dashboard and wallet.</p>

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
            autoComplete="email"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="mb-1.5 text-xs text-blue-400 hover:text-blue-300">
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          <LogIn className="h-4 w-4" />
          Sign in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        OR
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <a href="/api/auth/google" className="block">
        <Button variant="secondary" className="w-full" type="button">
          <span className="text-base font-bold text-blue-400">G</span>
          Continue with Google
        </Button>
      </a>

      <p className="mt-6 text-center text-sm text-slate-400">
        New here?{" "}
        <Link href="/register" className="font-medium text-blue-400 hover:text-blue-300">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
