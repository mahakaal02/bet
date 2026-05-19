import type { NextConfig } from "next";

// Backend host where uploaded auction images live. Build-time inlined
// via the workflow (`NEXT_PUBLIC_BACKEND_URL=https://kalki-backend.cloud.podstack.ai`)
// and falls back to the local dev backend so `npm run dev` keeps working.
const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

// Pull the hostname out for `images.remotePatterns` so Next's optimizer
// (when we ever flip `unoptimized` off) accepts backend URLs.
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
  reactStrictMode: true,
  // Auction product images can come from anywhere the admin uploads — for
  // dev we accept picsum (seed data) and the backend's local /uploads
  // mount. The Bet markets page used `unoptimized` for the same reason;
  // here we explicitly allow them so `next/image` works without surprises.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "10.0.2.2" },
      ...(backendHost && backendProtocol
        ? [{ protocol: backendProtocol, hostname: backendHost }]
        : []),
    ],
  },
  /**
   * Upload artefacts persist on the backend's volume and are served from
   * `${BACKEND_URL}/uploads/<filename>`. The upload controller currently
   * returns a relative URL ("/uploads/foo.jpg") so a browser on the
   * auctions origin (`kalki-auctions.cloud.podstack.ai`) would resolve
   * that path against itself — and 404, because the Next.js auctions app
   * doesn't serve /uploads/. We rewrite the path back to the backend so
   * the legacy relative URLs in existing Auction.imageUrls rows keep
   * working without a data migration.
   */
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${BACKEND_URL}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
