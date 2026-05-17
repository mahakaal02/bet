import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

/**
 * GET /api/auth/token
 *
 * Returns the user's backend JWT so Client Components can attach it to
 * a WebSocket subscribe message. Same-origin XHR only — the cookie
 * stays HTTP-only for all other JS, but the WS gateway needs the raw
 * token in its `subscribe` payload (it lives on a different origin,
 * port 4000, so HTTP cookies don't ride along on the WS upgrade).
 *
 * Returns 401 (not redirect) if no session, so the caller can render a
 * graceful "sign in to see live status" hint.
 */
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ token: null }, { status: 401 });
  }
  return NextResponse.json({ token });
}
