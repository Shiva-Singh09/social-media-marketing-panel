"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Animated counter card used on the dashboards. */
export function StatsCard({
  label,
  value,
  prefix = "",
  suffix = "",
  icon,
  accent = "blue",
  decimals = 0,
  hint,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  icon?: ReactNode;
  accent?: "blue" | "violet" | "emerald" | "amber" | "rose";
  decimals?: number;
  hint?: string;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    const steps = 28;
    const start = 0;
    const id = window.setInterval(() => {
      frame += 1;
      const progress = Math.min(1, frame / steps);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (value - start) * eased);
      if (progress === 1) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [value]);

  const accents: Record<string, string> = {
    blue: "from-blue-500/20 to-blue-500/0 text-blue-300 border-blue-500/20",
    violet: "from-violet-500/20 to-violet-500/0 text-violet-300 border-violet-500/20",
    emerald: "from-emerald-500/20 to-emerald-500/0 text-emerald-300 border-emerald-500/20",
    amber: "from-amber-500/20 to-amber-500/0 text-amber-300 border-amber-500/20",
    rose: "from-rose-500/20 to-rose-500/0 text-rose-300 border-rose-500/20",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-slate-900/60 p-5 shadow-lg shadow-black/20",
        accents[accent],
      )}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-70", accents[accent])} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {prefix}
            {display.toLocaleString("en-IN", {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })}
            {suffix}
          </p>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        {icon ? (
          <span className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-2.5">{icon}</span>
        ) : null}
      </div>
    </div>
  );
}
