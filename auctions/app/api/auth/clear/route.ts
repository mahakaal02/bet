import { NextResponse } from "next/server";
import { clearSessionToken } from "@/lib/session";

/**
 * GET /api/auth/clear?next=<path>
 *
 * Minimal session-cookie clear for server components that detect a
 * stale / rejected `kalki_token` (e.g. the hub's `/auth/me` returns
 * 401). A React Server Component can't mutate cookies during render, so
 * it `redirect()`s here; we delete the cookie and bounce to `next`
 * (default the localized login page).
 *
 * Deliberately NOT `/api/auth/logout`: that route also sets the 60s
 * `kalki_logged_out` guard and runs the cross-app SSO logout chain. Here
 * the user isn't logging out — their token merely expired — so we want
 * an immediate clean re-login (including via an SSO `?token=` hand-off),
 * which the logout guard would otherwise block for 60s.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await clearSessionToken();

  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");
  // Same-origin paths only — never an open redirect.
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/login";

  // Behind Traefik path-routing, `url.origin` is the pod's internal
  // listen address (e.g. http://localhost:3200) — redirecting the
  // browser there would land it on an unreachable URL. Prefer the pinned
  // NEXTAUTH_URL (= https://kalki.bet in prod), mirroring the Telegram
  // callback; fall back to the request origin for local dev.
  const publicOrigin = (process.env.NEXTAUTH_URL ?? url.origin).replace(
    /\/$/,
    "",
  );

  return NextResponse.redirect(new URL(next, publicOrigin).toString(), {
    status: 303,
  });
}
