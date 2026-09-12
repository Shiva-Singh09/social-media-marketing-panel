"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { KeyRound, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Label } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, formatDate, formatINR } from "@/lib/utils";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [changing, setChanging] = useState(false);

  // Syncing local form state from the fetched session user; the strict
  // react-hooks/set-state-in-effect rule flags even conditional updates like
  // this, so suppress it for these lines only.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(user.name);
       
      setAvatar(user.avatar ?? "");
    }
  }, [user]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await apiFetch("/api/user/profile", {
      method: "PUT",
      body: JSON.stringify({ name, avatar }),
    });
    setSaving(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    await refresh();
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) return toast.error("New passwords do not match");
    setChanging(true);
    const res = await apiFetch("/api/user/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: passwords.current,
        newPassword: passwords.next,
      }),
    });
    setChanging(false);
    if (!res.success) return toast.error(res.message);
    toast.success(res.message);
    setPasswords({ current: "", next: "", confirm: "" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile settings</h1>
        <p className="text-sm text-slate-400">Manage your account details and security.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Account details" />
          <form onSubmit={saveProfile} className="space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="email">Email (read only)</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
            </div>
            <div>
              <Label htmlFor="avatar">Avatar URL</Label>
              <Input
                id="avatar"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </form>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Account summary" />
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Wallet balance</dt>
              <dd className="font-semibold text-emerald-300">
                {formatINR(user?.creditBalance ?? 0)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Role</dt>
              <dd>
                <Badge status={user?.role ?? "user"} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Status</dt>
              <dd>
                <Badge status={user?.status ?? "active"} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Member since</dt>
              <dd className="text-slate-300">{formatDate(user?.createdAt)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader title="Change password" subtitle="Minimum 8 characters, hashed with bcrypt (12 rounds)" />
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              required
              value={passwords.current}
              onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="next">New password</Label>
            <Input
              id="next"
              type="password"
              required
              minLength={8}
              value={passwords.next}
              onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              required
              value={passwords.confirm}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" loading={changing}>
              <KeyRound className="h-4 w-4" /> Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
