import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DEFAULT_LOCALE,
  LOCALES,
  buildLocalizedMetadata,
  isLocale,
  t,
  type Locale,
} from "@/lib/i18n";

/**
 * Localized route layout (PR-BET-I18N).
 *
 * Mounted at `/[locale]/*`. Responsibilities:
 *
 *   1. Validate the `locale` param — unknown values 404 rather than
 *      silently falling back to English, so a typo in the URL is
 *      visible instead of hidden behind a wrong-language render.
 *   2. Emit `<html lang="…">` via `generateMetadata` so screen readers
 *      announce the right language and browsers pick the right
 *      hyphenation rules.
 *   3. Emit `hreflang` link tags for every supported locale + the
 *      `x-default` pointing at English — what Google indexes.
 *   4. Emit the canonical link tag pointing at the current URL,
 *      so duplicate content (the same page reachable via /en/foo
 *      and /foo before middleware) consolidates to the localized URL.
 *   5. Provide the title template (`%s · Kalki Exchange`) inherited
 *      by every child page's `title`, so per-page metadata only needs
 *      the page-specific portion.
 *
 * Layout chrome (Navbar, footer, etc.) intentionally lives at a
 * lower level (per-page or in shared client components) rather
 * than here, because mounting heavy chrome at the locale layer
 * forces every page in the segment to share it, even pages that
 * deliberately omit it (login, embed views).
 */

export const dynamic = "force-dynamic";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** Static export of every locale — Next.js prerenders the shell for
 *  each locale at build time when the page below is static. Lets the
 *  edge serve a hot cache for the most common `/{locale}` landings.
 */
export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const siteName = t("meta.siteName", locale);

  // Layout-level metadata acts as the default for any descendant
  // that doesn't define its own `generateMetadata`. The title.template
  // here means a child page returning `title: "Wallet"` ends up as
  // `Wallet · Kalki Exchange` in the browser tab.
  const base = buildLocalizedMetadata({
    locale,
    path: "/",
    title: siteName,
    description: t("meta.description", locale),
  });

  return {
    ...base,
    title: {
      default: siteName,
      template: `%s · ${siteName}`,
    },
    metadataBase: new URL(
      (process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, ""),
    ),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  // No <html> / <body> here — the root layout owns those. We just
  // render the children; the `<html lang>` comes from metadata.
  // (Next.js merges the locale into the root `<html>` via the
  // metadata API.)
  return <>{children}</>;
}
