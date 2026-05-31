import type { NextConfig } from "next";

// Backend host where uploaded market banners live. The bet app uses
// `/admin/uploads` on backend to receive files; the endpoint returns a
// relative URL ("/uploads/foo.jpg") stored on Market.bannerUrl. The
// browser would resolve that against the bet origin and 404; the
// rewrite below proxies the request back to the backend.
const BACKEND_URL = (
  process.env.AUCTIONS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

let backendHost: string | undefined;
let backendProtocol: "http" | "https" | undefined;
try {
  const u = new URL(BACKEND_URL);
  backendHost = u.hostname;
  backendProtocol = u.protocol === "https:" ? "https" : "http";
} catch {
  /* keep the fallback empty — config still works */
}

const nextConfig: NextConfig = {
  // Mount the entire app under /markets so it can be served from the
  // kalki.bet apex via Traefik's `PathPrefix(/markets)` route without an
  // addPrefix middleware: every internal link, API route, asset URL
  // (/_next/...) and 3xx the locale middleware emits is automatically
  // prefixed by Next, so the rendered page actually loads its CSS/JS
  // when fetched via kalki.bet/markets instead of falling through to
  // the auctions catch-all. assetPrefix defaults to basePath in Next
  // 14+, so the matching /_next/static/... requests stay under the
  // same prefix and reach this pod.
  //
  // Side effect: the legacy kalki-bet.cloud.podstack.ai subdomain now
  // serves everything under /markets too — bare /en/* paths there
  // 308-redirect to /markets/en/*. Cross-app links from auctions
  // (NEXT_PUBLIC_EXCHANGE_URL = https://kalki-bet.cloud.podstack.ai)
  // therefore pay one extra hop until that env is repointed at
  // https://kalki.bet/markets in CI — a follow-up rebuild of auctions
  // + aviator.
  basePath: "/markets",
  // Embedded in the Android WebView at 10.0.2.2:3100. CORS / referrers are
  // not an issue since the WebView is same-origin to its own page, but we
  // disable strict CSP headers from Next so unsplash images load on the
  // mobile WebView without extra config.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      ...(backendHost && backendProtocol
        ? [{ protocol: backendProtocol, hostname: backendHost }]
        : []),
    ],
  },
  /**
   * Banner uploads return `/uploads/<filename>` and that path lives on
   * the backend, not the bet app. Proxy through so existing
   * Market.bannerUrl rows render without a data migration.
   */
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${BACKEND_URL}/uploads/:path*`,
      },
    ];
  },
  /**
   * Cross-app links from auctions/aviator still target the legacy non-
   * basePath URLs on the bet subdomain:
   *   - `${EXCHANGE_URL}/?token=…`           (hub → bet SSO bridge)
   *   - `${EXCHANGE_URL}/wallet?token=…`     (hub → wallet topup CTA)
   *   - `${EXCHANGE_URL}/admin?token=…`      (admin SSO landing)
   *   - `${EXCHANGE_URL}/api/auth/sso-logout` (logout chain)
   *
   * After basePath: '/markets', these now land outside the served path
   * and 404 before middleware (which only runs inside basePath) — the
   * SSO ?token=… bridge breaks. Forward them to their basePath-prefixed
   * homes; query strings are preserved by default, so ?token=… survives
   * the hop and the middleware on the next request picks it up.
   *
   * basePath:false on each entry tells Next NOT to prepend /markets to
   * the source pattern — we WANT to match the bare URL.
   */
  async redirects() {
    return [
      // SSO bridge entry (hub → bet)
      { source: "/", destination: "/markets", basePath: false, permanent: false },
      // Wallet deep-link from hub + aviator
      { source: "/wallet", destination: "/markets/wallet", basePath: false, permanent: false },
      { source: "/wallet/:path*", destination: "/markets/wallet/:path*", basePath: false, permanent: false },
      // Admin deep-link from hub
      { source: "/admin", destination: "/markets/admin", basePath: false, permanent: false },
      { source: "/admin/:path*", destination: "/markets/admin/:path*", basePath: false, permanent: false },
      // Logout chain (auctions → bet sso-logout → aviator → back)
      { source: "/api/auth/sso-logout", destination: "/markets/api/auth/sso-logout", basePath: false, permanent: false },
    ];
  },
  // Strip console.* from production bundles (keep error/warn for prod
  // diagnostics). Trims client JS and avoids noisy logs.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  experimental: {
    typedRoutes: false,
    // Tree-shake heavy libs down to per-component imports → smaller
    // client chunks. recharts (~145KB) + framer-motion (~35KB) are the
    // two biggest contributors behind login.
    optimizePackageImports: ["recharts", "framer-motion"],
  },
};

export default nextConfig;
