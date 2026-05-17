import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/lib/boot";
import { SessionProvider } from "@/components/SessionProvider";
import { Toaster } from "@/components/ui/Toaster";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
