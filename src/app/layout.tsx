import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SMM Panel — Cheapest Social Media Marketing Services in India",
  description:
    "Buy Instagram followers, YouTube views, TikTok likes and more at wholesale prices. Instant delivery, Razorpay payments, 24x7 support.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading `headers()` is a dynamic API — calling it here opts every page
  // into dynamic rendering, which is required for the per-request CSP nonce
  // (set in src/middleware.ts) to be meaningful. Next.js automatically
  // attaches this nonce to its own framework/page scripts once it detects
  // the `nonce-*` pattern in the Content-Security-Policy header.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-[#0f172a] font-sans text-slate-100 antialiased">
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#1e293b",
                color: "#f8fafc",
                border: "1px solid #334155",
                borderRadius: "12px",
                fontSize: "14px",
              },
              success: { iconTheme: { primary: "#22c55e", secondary: "#0f172a" } },
              error: { iconTheme: { primary: "#ef4444", secondary: "#0f172a" } },
            }}
          />
        </AuthProvider>
        {/* Placeholder to keep `nonce` referenced for any future inline <Script nonce={nonce}> usage. */}
        <span data-csp-nonce={nonce} hidden aria-hidden="true" />
      </body>
    </html>
  );
}
