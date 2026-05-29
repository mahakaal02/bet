import { NextResponse } from "next/server";

/**
 * GET /api/aviator/teaser-multiplier
 *
 * Anonymous proxy to the backend's `/aviator/public/teaser-multiplier`.
 * Surfaced as a same-origin Next.js route so the landing-page client
 * can fetch a teaser multiplier without a cross-origin preflight.
 *
 * The landing-page aviator widget is DE-LINKED from the live aviator
 * engine — it shows a self-contained stream of random multipliers.
 * The generation logic lives entirely on the backend (it must not
 * ship in the client bundle); this route only forwards the finished
 * value.
 *
 * Response shape (mirrors backend):
 *   { multiplier: string | null }
 *
 * On any failure (backend down, network error) we return
 * `{ multiplier: null }` with a 200 so the client can fall back to a
 * neutral placeholder.
 */
export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/aviator/public/teaser-multiplier`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ multiplier: null });
    }
    const body = (await res.json()) as { multiplier: string | null };
    return NextResponse.json({ multiplier: body.multiplier ?? null });
  } catch {
    return NextResponse.json({ multiplier: null });
  }
}
