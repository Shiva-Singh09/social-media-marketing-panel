import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `/api/v1/*` is the versioned, forward-compatible entry point for external
  // integrations. It's implemented as a rewrite onto the existing `/api/*`
  // handlers so today's contract is preserved while giving us a place to
  // introduce breaking `/api/v2` changes later without touching v1 clients.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "/api/:path*" }];
  },
  async headers() {
    // Content-Security-Policy is intentionally NOT set here — it needs a
    // fresh per-request nonce for script-src, which is only available in
    // middleware (see src/middleware.ts). Only static, request-independent
    // headers live in next.config.
    // HSTS is production-only: localhost/development runs plain HTTP, and a
    // browser that once cached HSTS for localhost would refuse HTTP afterwards.
    const hsts =
      process.env.NODE_ENV === "production"
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=63072000; includeSubDomains",
            },
          ]
        : [];
    return [
      {
        source: "/:path*",
        headers: [
          ...hsts,
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
