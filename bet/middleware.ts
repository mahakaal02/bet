import { NextResponse, type NextRequest } from "next/server";

/**
 * Universal SSO entry for Bet. Any request that arrives with `?token=…`
 * gets bounced to `/api/auth/sso?token=…&next=<original>` — the route
 * handler verifies the JWT, mints a NextAuth session, and redirects
 * back to the original URL with the user signed in.
 *
 * Why middleware + route handler instead of just the existing
 * `TokenBridge` client component:
 *
 *   - `TokenBridge` only renders on `/`. Deep links like
 *     `/wallet?token=…` (used by the auctions app's "Top up" chip)
 *     never get a chance to consume the token because `/wallet`
 *     server-side `redirect(/login)`s before any client code runs.
 *   - Middleware fires before the page handler, so we can divert to
 *     the sso route handler regardless of which page the user landed
 *     on.
 *
 * Edge-runtime constraint: middleware can't talk to Prisma, so the
 * actual user-find + JWT-mint lives in the Node-runtime route handler
 * (`app/api/auth/sso/route.ts`). Middleware does the URL surgery only.
 */
export function middleware(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.next();
  // Don't intercept the sso route itself — that's where we're going.
  if (req.nextUrl.pathname.startsWith("/api/auth/sso")) {
    return NextResponse.next();
  }

  const cleanUrl = req.nextUrl.clone();
  cleanUrl.searchParams.delete("token");

  const sso = req.nextUrl.clone();
  sso.pathname = "/api/auth/sso";
  sso.searchParams.set("next", cleanUrl.pathname + cleanUrl.search);
  // `token` stays as a query param on the sso URL.

  return NextResponse.redirect(sso);
}

export const config = {
  // Skip Next.js internals + static assets — only intercept user-facing
  // routes. NextAuth's own /api/auth/* routes are excluded so the
  // standard signin/signout/session-token endpoints work normally.
  matcher: [
    "/((?!_next|favicon.ico|kalki-logo.png|logo.png|api/auth(?!/sso)).*)",
  ],
};
