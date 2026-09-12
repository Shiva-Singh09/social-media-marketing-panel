"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  LogOut,
  Menu,
  Package,
  Rocket,
  Settings,
  ShoppingCart,
  Tags,
  Users,
  User,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { cn, formatINR } from "@/lib/utils";
import { Skeleton } from "@/components/ui";
import { VerifyEmailGate } from "@/components/VerifyEmailGate";

export type NavItem = { href: string; label: string; icon: ReactNode };

export const USER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
  { href: "/new-order", label: "New Order", icon: <ShoppingCart className="h-4.5 w-4.5" /> },
  { href: "/orders", label: "My Orders", icon: <ListOrdered className="h-4.5 w-4.5" /> },
  { href: "/add-funds", label: "Add Funds", icon: <Wallet className="h-4.5 w-4.5" /> },
  { href: "/support", label: "Support", icon: <LifeBuoy className="h-4.5 w-4.5" /> },
  { href: "/profile", label: "Profile", icon: <User className="h-4.5 w-4.5" /> },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview", icon: <BarChart3 className="h-4.5 w-4.5" /> },
  { href: "/admin/users", label: "Users", icon: <Users className="h-4.5 w-4.5" /> },
  { href: "/admin/categories", label: "Categories", icon: <Tags className="h-4.5 w-4.5" /> },
  { href: "/admin/services", label: "Services", icon: <Package className="h-4.5 w-4.5" /> },
  { href: "/admin/orders", label: "Orders", icon: <ListOrdered className="h-4.5 w-4.5" /> },
  { href: "/admin/transactions", label: "Transactions", icon: <Wallet className="h-4.5 w-4.5" /> },
  { href: "/admin/support", label: "Support", icon: <LifeBuoy className="h-4.5 w-4.5" /> },
  { href: "/admin/settings", label: "Settings", icon: <Settings className="h-4.5 w-4.5" /> },
];

export function PanelShell({
  children,
  nav,
  adminOnly = false,
}: {
  children: ReactNode;
  nav: NavItem[];
  adminOnly?: boolean;
}) {
  const { user, settings, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (adminOnly && user.role !== "admin") {
      toast.error("Admin access required");
      router.replace("/dashboard");
    }
  }, [loading, user, adminOnly, router, pathname]);

  // Closing the mobile sidebar on route change is an external-system sync
  // (URL → UI state); the strict react-hooks/set-state-in-effect rule flags
  // it, so suppress for this line only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  if (loading || !user || (adminOnly && user.role !== "admin")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f172a] p-6">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    toast.success("Signed out");
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-[#0f172a]">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-800 bg-slate-950/95 backdrop-blur transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500">
              <Rocket className="h-5 w-5 text-white" />
            </span>
            <span className="font-bold">{settings?.siteName ?? "SMM Panel"}</span>
          </Link>
          <button className="rounded-lg p-1 text-slate-400 lg:hidden" onClick={() => setOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-gradient-to-r from-blue-500/20 to-violet-500/10 text-white shadow-inner shadow-blue-500/10"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-3">
          {user.role === "admin" ? (
            <Link
              href={adminOnly ? "/dashboard" : "/admin/dashboard"}
              className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-violet-300 hover:bg-slate-900"
            >
              <Settings className="h-4.5 w-4.5" />
              {adminOnly ? "User panel" : "Admin panel"}
            </Link>
          ) : null}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-4.5 w-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      {open ? (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Content */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-300 hover:bg-slate-900 lg:hidden"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-100">
                {adminOnly ? "Admin Console" : `Welcome back, ${user.name.split(" ")[0]}`}
              </p>
              <p className="text-xs text-slate-500">{new Date().toDateString()}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/add-funds"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
            >
              {formatINR(user.creditBalance)}
            </Link>
            <button className="relative rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-200">
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-400" />
            </button>
            <Link
              href="/profile"
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1.5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-bold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="hidden text-sm text-slate-200 sm:inline">{user.name}</span>
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {user.role !== "admin" && !user.emailVerified ? (
            <VerifyEmailGate email={user.email} />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
