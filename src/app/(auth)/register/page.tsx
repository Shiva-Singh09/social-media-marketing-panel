"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { UserPlus } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
    });
    setLoading(false);

    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success("Account created — welcome aboard!");
    await refresh();
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-white">Create your account</h1>
      <p className="mt-1 text-sm text-slate-400">Free forever — pay only for what you order.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" required value={form.name} onChange={update("name")} placeholder="Rahul Sharma" />
        </div>
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={update("email")}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={update("password")}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            required
            value={form.confirm}
            onChange={update("confirm")}
            placeholder="Repeat password"
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          <UserPlus className="h-4 w-4" />
          Create account
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
          Sign up with Google
        </Button>
      </a>

      <p className="mt-6 text-center text-sm text-slate-400">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
