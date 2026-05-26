import type { MetadataRoute } from "next";

/**
 * robots.txt (PR-AUCTIONS-I18N).
 *
 * Explicit allow on all four locale roots, with explicit disallow on
 * api / authenticated-only surfaces. Without this file Next.js
 * doesn't emit a robots.txt, which means crawlers infer "everything
 * is fair game" — including profile/me/* pages that 401-then-redirect
 * and waste crawl budget.
 *
 * Pointing crawlers at our locale-aware sitemap (which carries
 * hreflang via `alternates.languages`) is what makes Google index
 * all four language trees instead of just `/en/`.
 */
export default function robots(): MetadataRoute.Robots {
  const origin =
    process.env.NEXT_PUBLIC_AUCTIONS_URL?.replace(/\/$/, "") ??
    "http://localhost:3200";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/en/", "/pt/", "/es/", "/fr/"],
        // Service + authenticated surfaces — never indexable.
        disallow: [
          "/api/",
          "/me/",
          "/profile/",
          "/notifications/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
