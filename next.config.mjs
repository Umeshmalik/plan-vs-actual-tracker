const isDev = process.env.NODE_ENV === "development";

/**
 * One CSP for the whole app, and it can be this tight because the app has no
 * third-party origins at all: no CDN, no analytics, no tag manager, no hosted
 * font service. next/font self-hosts Archivo / Bitter / IBM Plex Mono out of
 * /_next/static, recharts draws inline SVG rather than loading anything, and
 * the only network calls the browser makes are same-origin fetches to /api.
 * So `default-src 'self'` holds, and every directive below narrows it further.
 */
const csp = [
  "default-src 'self'",

  // Next's App Router ships the RSC payload and the bootstrap in inline
  // <script> tags. Those carry a nonce only if a middleware mints one per
  // request; this app has no middleware, so 'unsafe-inline' is required in
  // production too — dropping it renders a blank page, not a hardened one.
  // ponytail: the upgrade is a middleware that generates a per-request nonce
  // and swaps this for `'nonce-…' 'strict-dynamic'`. Worth doing the day this
  // app renders anything a user typed into a <script>-adjacent position; today
  // every value it prints goes through React's escaping.
  // 'unsafe-eval' is dev-only: the dev bundler evals modules for hot reload.
  // Production never gets it.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,

  // Tailwind v4 and next/font both emit an inline <style>, and React writes
  // style attributes (the chart sizes itself that way). No way around it
  // without a nonce, and the risk is far lower than for script.
  "style-src 'self' 'unsafe-inline'",

  "img-src 'self' data:", // data: for inline SVG/blob icons
  "font-src 'self'", // next/font self-hosts — nothing from fonts.gstatic.com
  // Same-origin XHR/fetch only. Dev adds the HMR websocket.
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'", // the modern half of X-Frame-Options
  "form-action 'self'", // a stolen form cannot post the session anywhere else
  "base-uri 'self'", // no <base> rewrite of every relative URL
  "object-src 'none'", // no Flash/applet/embed surface at all
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // App Runner terminates TLS in front of this container, so the browser should
  // never try http:// again. Two years, subdomains included, preload-eligible.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // No MIME sniffing: a JSON error envelope can never be executed as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the origin cross-site, the full URL same-site: ?from=&to=&categoryId=
  // are one tenant's business, and they live in the query string.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Clickjacking, for browsers older than frame-ancestors. Nothing embeds this.
  { key: "X-Frame-Options", value: "DENY" },
  // A finance tracker asks for no hardware. Deny it up front.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is what makes the Dockerfile's runtime image small. Vercel
  // builds its own serverless bundle and standalone only gets in its way, so it
  // is off there — one config, both targets, no second next.config to drift.
  output: process.env.VERCEL ? undefined : "standalone",

  // Applied to every route — pages, API and static assets alike. Per-response
  // headers (Cache-Control: no-store, x-request-id) are set in lib/route.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
