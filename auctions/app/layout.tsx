import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SessionHeartbeat } from "@/components/SessionHeartbeat";

export const metadata: Metadata = {
  title: "Kalki Auctions",
  description:
    "Lowest-unique-bid auctions. Pay coins per bid, win real products.",
};

/**
 * Mobile viewport. Without this, Next.js falls back to a layout-mode-only
 * default and iOS Safari renders at the 980px virtual viewport — every
 * page looks zoomed-in. Setting `width=device-width` + `initialScale=1`
 * is the modern responsive default.
 *
 * iOS also auto-zooms when any `<input>` smaller than 16pt gains focus —
 * we handle that at the component level (`components/ui/Input.tsx`) by
 * making the input font size 16px, so we don't need `maximumScale=1`
 * here. That preserves user pinch-zoom for accessibility.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1020",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* PR-LOGIN-REDESIGN — Space Grotesk (display/UI) + JetBrains
            Mono (live numbers, tickers) for the hub landing/login.
            Loaded once at the document level so subsequent navigations
            don't refetch; CJK/Arabic fallbacks live in the page CSS. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Sans+Arabic:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] antialiased">
        {/* Mounted globally so the session-reminder heartbeat pings
            irrespective of which page the user is on. The component
            self-suppresses when the tab is hidden. */}
        <SessionHeartbeat />
        {children}
      </body>
    </html>
  );
}
