import { NextResponse } from "next/server";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
  type WatchToggleResponse,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST   /api/watchlist/:auctionId  — start watching
 * DELETE /api/watchlist/:auctionId  — stop watching
 *
 * Both endpoints proxy to the backend's `/auctions/:id/watch` route
 * pair. Idempotent on both sides (re-POSTing returns
 * `alreadyWatching: true`; re-DELETEing returns `removed: 0`).
 */

interface RouteContext {
  params: Promise<{ auctionId: string }>;
}

async function withAuth<T>(
  handler: (token: string) => Promise<T>,
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { message: "Sign in to manage your watchlist." },
      { status: 401 },
    );
  }
  try {
    const data = await handler(token);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Watchlist operation failed." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

export async function POST(_req: Request, ctx: RouteContext) {
  const { auctionId } = await ctx.params;
  return withAuth((token) =>
    backend
      .authed(token)
      .post<WatchToggleResponse>(`/auctions/${auctionId}/watch`, {}),
  );
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { auctionId } = await ctx.params;
  return withAuth((token) =>
    backend
      .authed(token)
      .delete<WatchToggleResponse>(`/auctions/${auctionId}/watch`),
  );
}
