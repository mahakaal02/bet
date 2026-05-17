import type { NextConfig } from "next";

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
    ],
  },
};

export default nextConfig;
