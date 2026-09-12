import Link from "next/link";
import type { ReactNode } from "react";
import { Rocket } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-blue-500/30">
          <Rocket className="h-5 w-5 text-white" />
        </span>
        <span className="text-xl font-bold">SMM Panel</span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-6 text-xs text-slate-500">
        Protected by JWT sessions, bcrypt hashing and IP rate limiting.
      </p>
    </div>
  );
}
