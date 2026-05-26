import type { MetadataRoute } from "next";

/**
 * robots.txt (PR-AVIATOR-I18N).
 *
 * Explicit allow on all four locale roots, with explicit disallow on
 * auth/api/service surfaces. Without this file Next.js doesn't emit
 * a robots.txt, which means crawlers infer "everything is fair game"
 * — including authenticated pages with the bounce-to-login flow that
 * wastes their crawl budget.
 *
 * Pointing crawlers at our locale-aware sitemap (which carries
 * hreflang via `alternates.languages`) is what makes Google index
 * all four language trees instead of just `/en/`.
 */
export default function robots(): MetadataRoute.Robots {
  const origin =
    process.env.NEXT_PUBLIC_AVIATOR_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/en/", "/pt/", "/es/", "/fr/"],
        // Authenticated + service surfaces — never indexable.
        disallow: [
          "/api/",
          "/profile/",
          "/notifications/",
          "/withdraw/",
          "/logout/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
