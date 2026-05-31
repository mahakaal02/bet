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
