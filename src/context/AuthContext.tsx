"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/utils";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | string;
  status: string;
  creditBalance: string;
  avatar: string | null;
  emailVerified: boolean;
  createdAt: string;
};

export type PublicSettings = {
  siteName: string;
  siteLogo: string | null;
  minCreditAmount: number;
  announcementText: string;
  supportEmail: string | null;
  maintenanceMode: boolean;
};

type AuthState = {
  user: SessionUser | null;
  settings: PublicSettings | null;
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ user: SessionUser | null; settings: PublicSettings }>("/api/auth/me");
    setUser(res.data?.user ?? null);
    setSettings(res.data?.settings ?? null);
    setLoading(false);
    return res.data?.user ?? null;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  // Session bootstrap on mount necessarily resolves into setState; the strict
  // react-hooks/set-state-in-effect rule flags even post-await updates
  // reached through a named callback, so suppress it for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, settings, loading, refresh, logout, setUser }),
    [user, settings, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
