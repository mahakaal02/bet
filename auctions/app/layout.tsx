import "./globals.css";
import type { Metadata, Viewport } from "next";

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
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
