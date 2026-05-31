import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DEFAULT_LOCALE,
  LOCALES,
  buildLocalizedMetadata,
  dictionaryFor,
  isLocale,
  t,
  type Locale,
} from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";

/**
 * Localized route layout (PR-AVIATOR-I18N).
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
 *   5. Provide the title template (`%s · Kalki Aviator`) inherited
 *      by every child page's `title`, so per-page metadata only needs
 *      the page-specific portion.
 *
 * Layout chrome (Navbar etc.) intentionally lives at a lower level
 * (per-page or in shared client components) rather than here, because
 * mounting heavy chrome at the locale layer forces every page in the
 * segment to share it, even pages that deliberately omit it (logout
 * splash, embed views).
 */

// No blanket `force-dynamic` here — on the segment layout it cascaded to
// EVERY child route and made the whole app uncacheable (every response
// `cf-cache-status: DYNAMIC`, full origin SSR per navigation). Pages opt
// into dynamic rendering themselves by reading cookies()/headers() or
// fetching with `cache: "no-store"`; truly-static routes can now be cached.

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
  // here means a child page returning `title: "Fairness"` ends up as
  // `Fairness · Kalki Aviator` in the browser tab.
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
      (process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000").replace(
        /\/$/,
        "",
      ),
    ),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  // Resolve the dictionary on the server, pre-merged with the English
  // fallback. This single dictionary travels to the client via the
  // RSC payload (as data) and lands in the I18nProvider context.
  // The bundler never sees a static import of any dictionary file
  // from a client module, so the dictionaries DON'T get bundled into
  // shared client chunks — only the active locale's data ships per
  // request.
  const dictionary = dictionaryFor(locale);
  return (
    <I18nProvider locale={locale} dictionary={dictionary}>
      {children}
    </I18nProvider>
  );
}
