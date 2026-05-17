/**
 * Browser-side resolver for Bet/Exchange URLs. The wallet topup flow
 * lives on the Bet app (`http://localhost:3100`), so any in-auctions
 * CTA that nudges the user to recharge needs a working link.
 *
 * Same trick as `backend-url.ts`: pick the host at runtime so the same
 * built bundle works in a desktop browser (`localhost`), inside the
 * Android emulator (`10.0.2.2`), and over LAN (any other host).
 */
export function exchangeOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EXCHANGE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:3100`;
    }
  }
  return "http://localhost:3100";
}

export function walletTopupUrl(token: string | null): string {
  const base = `${exchangeOrigin()}/wallet`;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}
