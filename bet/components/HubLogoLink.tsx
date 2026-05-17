"use client";

/**
 * Logo wrapper that links back to the Kalki hub at `:3200/` — the page
 * that lists all three games (Auctions, Aviator, Bet). The hub lives on
 * a separate origin from Bet, so we use a plain anchor instead of
 * Next.js' `<Link>` and let the browser do a full document load.
 *
 * Resolves the URL at click-time so the same bundle works in:
 *   - desktop browser  (`window.location.hostname === "localhost"`)
 *   - Android emulator (`10.0.2.2`)
 *   - LAN / production (any other host)
 *
 * Forwards a one-shot prevention: prefetching across origins is a non-
 * starter, so any `prefetch`/`href` Next would set is irrelevant — the
 * plain anchor is correct.
 */
export function HubLogoLink({ children }: { children: React.ReactNode }) {
  function hubUrl(): string {
    const fromEnv = process.env.NEXT_PUBLIC_AUCTIONS_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, "") + "/";
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host && host !== "localhost" && host !== "127.0.0.1") {
        return `http://${host}:3200/`;
      }
    }
    return "http://localhost:3200/";
  }

  return (
    <a
      href={hubUrl()}
      aria-label="Back to Kalki hub"
      className="inline-flex items-center"
    >
      {children}
    </a>
  );
}
