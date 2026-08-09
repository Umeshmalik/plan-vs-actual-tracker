const isDev = process.env.NODE_ENV === "development";

// `default-src 'self'` holds because the app has ZERO third-party origins —
// next/font self-hosts, recharts draws inline SVG, and every fetch is same-origin.
const csp = [
  "default-src 'self'",

  // Next's App Router ships the RSC payload in inline <script> tags with no
  // nonce unless a middleware mints one, so dropping 'unsafe-inline' renders a
  // blank page rather than a hardened one. 'unsafe-eval' is dev-only (HMR).
  // ponytail: upgrade is a middleware nonce + 'strict-dynamic'.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,

  // Tailwind v4, next/font and React's style attributes all emit inline style.
  "style-src 'self' 'unsafe-inline'",

  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`, // dev adds the HMR websocket
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone keeps the Docker runtime image small; Vercel builds its own bundle.
  output: process.env.VERCEL ? undefined : "standalone",

  // The `"use cache"` directive lib/reads.ts is built from.
  //
  // ponytail: Next 16 wants `cacheComponents: true`, which is NOT a rename — it
  // also switches on partial prerendering, which rejects the `force-dynamic` on
  // every API route and wants a Suspense boundary above every page reading
  // cookies or searchParams. All of them do, and all sit behind a session, so
  // the migration buys skeletons rather than speed. Revisit for a public page.
  experimental: { useCache: true },

  // Per-response headers (no-store, x-request-id) are set in lib/route.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
