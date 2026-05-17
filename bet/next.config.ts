import type { NextConfig } from "next";

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
    ],
  },
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
