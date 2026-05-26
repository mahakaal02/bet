import { NextResponse } from "next/server";

/**
 * GET /api/aviator/last-crash
 *
 * Anonymous proxy to the backend's `/aviator/public/last-crash`.
 * Surfaced as a same-origin Next.js route so the landing-page client
 * can fetch live aviator data without a cross-origin preflight.
 *
 * Response shape (mirrors backend):
 *   { multiplier: string | null, at: string | null }
 *
 * `multiplier` is a stringified decimal — matches the on-the-wire
 * shape of `crashMultiplier` everywhere else in the aviator API
 * (Prisma `Decimal` serialised as string to avoid float precision
 * loss on 64-bit JS clients).
 *
 * Failure modes (backend down, network error, etc.) return
 * `{ multiplier: null, at: null }` with a 200. The landing page
 * treats that as "no live data; render the local simulated value"
 * — better than a stat tile reading "—" while everything else on
 * the page ticks.
 */
export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/aviator/public/last-crash`, {
      // Backend has its own short cache (the route is throttled on
      // its side); we want fresh-on-request here since the client
      // already polls at a sane interval (~15s).
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ multiplier: null, at: null });
    }
    const body = (await res.json()) as {
      multiplier: string | null;
      at: string | null;
    };
    return NextResponse.json(body);
  } catch {
    // Network down, DNS, TLS — same swallow. The landing page falls
    // back to the local simulation; the rest of the page is unaffected.
    return NextResponse.json({ multiplier: null, at: null });
  }
}
