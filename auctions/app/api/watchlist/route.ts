import { NextResponse } from "next/server";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
  type WatchlistListResponse,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * GET /api/watchlist — bucketed list of the current user's watched
 * auctions, sorted LIVE → UPCOMING → other. Pure proxy to the
 * backend's `/me/watchlist`.
 *
 * 401 when there's no session. 403 when the `watchlist.enabled` flag
 * is OFF — surfaces as a friendly "this feature isn't on yet" on
 * the page.
 */
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in to view your watchlist." }, {
      status: 401,
    });
  }
  try {
    const data = await backend.authed(token).get<WatchlistListResponse>(
      "/me/watchlist",
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't load watchlist." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}
