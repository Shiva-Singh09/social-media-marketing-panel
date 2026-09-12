import Link from "next/link";
import { Rocket } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950/70">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500">
              <Rocket className="h-5 w-5 text-white" />
            </span>
            <span className="text-lg font-bold">SMM Panel</span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            India&apos;s most affordable social media marketing panel. Instant delivery, secure
            Razorpay payments and 24×7 human support.
          </p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Platform
          </h4>
          <ul className="space-y-2 text-sm text-slate-400">
            <li>
              <Link href="/services" className="hover:text-white">
                Services &amp; pricing
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-white">
                About us
              </Link>
            </li>
            <li>
              <Link href="/dashboard" className="hover:text-white">
                Dashboard
              </Link>
            </li>
            <li>
              <Link href="/support" className="hover:text-white">
                Support
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Account
          </h4>
          <ul className="space-y-2 text-sm text-slate-400">
            <li>
              <Link href="/login" className="hover:text-white">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-white">
                Create account
              </Link>
            </li>
            <li>
              <Link href="/forgot-password" className="hover:text-white">
                Forgot password
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800/70 px-4 py-5 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} SMM Panel. Built with Next.js, Drizzle ORM &amp; Razorpay.
      </div>
    </footer>
  );
}
