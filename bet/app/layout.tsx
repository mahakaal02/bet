import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "@/lib/boot";
import { SessionProvider } from "@/components/SessionProvider";
import { Toaster } from "@/components/ui/Toaster";
import {
  DEFAULT_LOCALE,
  LOCALE_HEADER,
  dirForLocale,
  isLocale,
  type Locale,
} from "@/lib/i18n";

/** Mobile viewport. Without this, Next.js doesn't emit a viewport meta
 *  and iOS Safari falls back to the 980px virtual viewport — every page
 *  looks zoomed-in on a phone-sized screen. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1020",
};

const SITE = {
  name: "Kalki Exchange",
  description:
    "Trade YES/NO on real-world events with your Kalki Bet coins — the same wallet that powers auctions and Aviator.",
};

// `metadataBase` lets relative OG image URLs resolve correctly when Slack /
// Twitter / iMessage unfurls a shared link. The siblings `opengraph-image`
// + `twitter-image` files are picked up automatically by Next 15's file-
// convention metadata; per-route overrides (see app/markets/[slug]) get
// merged in on top.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3100"),
  title: {
    default: SITE.name,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.description,
  },
};

/**
 * Root layout — wraps EVERY route (localized + non-localized).
 *
 * `<html lang>` + `<html dir>` are resolved per-request from the
 * `x-bet-locale` request header that middleware sets when a locale-
 * prefixed URL flows through. For paths outside the `[locale]/` tree
 * (e.g. `/admin/*` or `/share/*`) the header is absent and we fall
 * back to DEFAULT_LOCALE. This is the single source of truth for
 * the document language announcement — assistive tech keys off it.
 *
 * Why server-resolve instead of e.g. a `<HtmlLangSetter>` client
 * component? Screen readers read the initial `<html lang>` value
 * the moment the document loads; flipping it from JS post-hydration
 * is too late.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const raw = hdrs.get(LOCALE_HEADER);
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dir = dirForLocale(locale);

  return (
    <html lang={locale} dir={dir} className="dark">
      <body className="min-h-screen">
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
