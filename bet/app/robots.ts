import type { MetadataRoute } from "next";

/**
 * robots.txt (PR-BET-I18N).
 *
 * Explicit allow on all four locale roots + the markets tree, with
 * explicit disallow on admin/api/auth surfaces. Without this file
 * Next.js doesn't emit a robots.txt, which means crawlers infer
 * "everything is fair game" — including admin pages with the
 * 401-then-redirect flow that wastes their crawl budget.
 *
 * Pointing crawlers at our locale-aware sitemap (which carries
 * hreflang via `alternates.languages`) is what makes Google index
 * all four language trees instead of just `/en/`.
 */
export default function robots(): MetadataRoute.Robots {
  const origin =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/en/", "/pt/", "/es/", "/fr/"],
        // Operator + service surfaces — never indexable.
        disallow: [
          "/admin/",
          "/api/",
          "/profile/",
          "/wallet/",
          "/portfolio/",
          "/watchlist/",
          "/notifications/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
