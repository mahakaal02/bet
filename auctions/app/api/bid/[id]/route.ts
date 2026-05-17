import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/session";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";

/**
 * POST /api/bid/[id]
 *
 * Thin proxy: forwards `{amount}` to backend's
 * `POST /auctions/:id/bids` with the user's JWT attached. We do it
 * server-side (rather than letting the browser hit :4000 directly) for
 * two reasons:
 *   1. The JWT lives in an HTTP-only cookie — JS can't read it.
 *   2. We get to normalise error codes into a shape `BidForm` can
 *      render without parsing NestJS's nested error envelope.
 *
 * Bid placement is the only mutation in this whole app — everything
 * else (list, detail) is a public GET on the backend.
 */
const Body = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Use a number, up to 2 decimals."),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "Sign in to place a bid." },
      { status: 401 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "Bid amount looks invalid.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await backend
      .authed(token)
      .post<{ id: string; amount: string; placedAt: string }>(
        `/auctions/${id}/bids`,
        // Backend's PlaceBidDto requires `amount` as a string matching
        // `\d+(\.\d{1,2})?`. Zod above enforces the same shape.
        { amount: parsed.data.amount },
      );
    return NextResponse.json({ ok: true, bid: result });
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json(
        { ok: false, code: "unauthorized", message: "Session expired — sign in again." },
        { status: 401 },
      );
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { ok: false, code: err.code, message: humanise(err.code, err.message) },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { ok: false, code: "internal", message: "Couldn't place that bid." },
      { status: 500 },
    );
  }
}

function humanise(code: string, fallback: string): string {
  const map: Record<string, string> = {
    auction_not_found: "That auction doesn't exist anymore.",
    auction_not_live: "This auction isn't live yet.",
    auction_ended: "This auction has already closed.",
    insufficient_coins:
      "You don't have enough coins for this bid. Top up your wallet first.",
    invalid_bid_amount: "Bid amount is outside the allowed range.",
    duplicate_bid: "You've already placed that exact bid amount.",
    rate_limited: "Slow down — too many bids in a short window.",
  };
  return map[code] ?? fallback;
}
