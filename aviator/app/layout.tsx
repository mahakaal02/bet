import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_HEADER,
  dirForLocale,
  isLocale,
  type Locale,
} from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Kalki Aviator',
  description: 'Crash-curve betting game — watch the plane climb, cash out before it crashes.',
};

/** Mobile viewport so iOS Safari doesn't render at the 980px virtual
 *  width (which makes the whole game look zoomed in on a phone). */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080B1A',
};

/**
 * Root layout sits ABOVE the `[locale]/` segment, so it doesn't get
 * access to `params.locale`. The middleware writes the resolved
 * locale to the `x-aviator-locale` request header; we read that
 * here to emit the right `<html lang>` and `<html dir>`.
 *
 * Falls back to `en` / `ltr` when the header isn't present (direct
 * requests that bypass middleware, e.g. error pages).
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const rawLocale = headersList.get(LOCALE_HEADER);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dir = dirForLocale(locale);
  return (
    <html lang={locale} dir={dir} className="dark">
      <body className="min-h-screen bg-bg text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
