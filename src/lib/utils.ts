import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(value: number | string | null | undefined, withSymbol = true) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = safe.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `₹${formatted}` : formatted;
}

export function formatNumber(value: number | string | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN");
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  processing: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  in_progress: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  partial: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  cancelled: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  failed: "bg-red-500/10 text-red-300 border-red-500/30",
  open: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  replied: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  closed: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  inactive: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  blocked: "bg-red-500/10 text-red-300 border-red-500/30",
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  credit: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  debit: "bg-red-500/10 text-red-300 border-red-500/30",
};

export function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function orderCost(quantity: number, pricePer1000: number) {
  return Math.round((quantity / 1000) * pricePer1000 * 100) / 100;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Client-side fetch wrapper that always returns the API envelope. */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<{ success: boolean; data: T | null; message: string }> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  // Double-submit CSRF token: the server issues this cookie on first load;
  // echoing it back as a header proves the request came from a page that
  // could actually read our cookies (i.e. our own origin).
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie("csrf_token");
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  let json: { success?: boolean; data?: T | null; message?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = { success: false, message: `Request failed (${res.status})` };
  }
  return {
    success: Boolean(json.success) && res.ok,
    data: (json.data ?? null) as T | null,
    message: json.message ?? (res.ok ? "OK" : `Request failed (${res.status})`),
  };
}
