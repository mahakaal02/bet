import { NextResponse } from "next/server";
import { clearSessionToken, setLoggedOutFlag } from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 * Single sign-out across all three Kalki games. Each app owns its own
 * session technology (cookie here, NextAuth cookie on Bet, localStorage
 * on Aviator), and same-origin policies forbid one app from reaching
 * into another's storage. The chain works around that by hopping the
 * user's browser through each origin's logout endpoint:
 *
 *   1. (here) clear the auctions `kalki_token` cookie + set the
 *      `kalki_logged_out` guard cookie so middleware refuses any
 *      `?token=` URL params for 60s.
 *   2. 303 → `:3100/api/auth/sso-logout?next=…`  (Bet clears its cookie)
 *   3. 303 → `:3000/logout?next=…`               (Aviator clears localStorage)
 *   4. 303 → `:3200/login`                       (back to app login)
 *
 * If any hop is offline the chain breaks and the user lands somewhere
 * with a mixed state — but the local `kalki_token` cookie is already
 * gone and the `kalki_logged_out` flag is set, so they're functionally
 * signed out on this origin regardless of how far the chain got.
 *
 * Defensive URL building (PR-WEB-LOGOUT-FIX):
 *
 *   The previous version trusted `process.env.NEXT_PUBLIC_*` at runtime
 *   and fell back to `http://localhost:31xx` if any var was missing.
 *   In production that fallback caused a hard 404 / connection error
 *   ("This site can't be reached") because the browser tried to load a
 *   localhost URL from an HTTPS page — symptom: "clicking signout
 *   shows a 404".
 *
 *   We now also fall back to deriving the bet/aviator base URLs from
 *   the REQUEST host pattern (`kalki-auctions.cloud.podstack.ai` →
 *   `kalki-bet.cloud.podstack.ai`, `kalki-aviator…`). This makes the
 *   chain self-healing: even if a helm misconfiguration drops the env
 *   var, the redirect still goes to the right cluster host.
 */

const FINAL_LANDING = process.env.NEXT_PUBLIC_AUCTIONS_URL ?? "http://localhost:3200";
const EXCHANGE_BASE_FROM_ENV = process.env.NEXT_PUBLIC_EXCHANGE_URL;
const AVIATOR_BASE_FROM_ENV = process.env.NEXT_PUBLIC_AVIATOR_URL;

/**
 * Pick a base URL with the following preference:
 *   1. Trustworthy env var (https://… and not pointing at localhost).
 *   2. Derive from the request host by swapping the service prefix —
 *      `kalki-auctions.<rest>` → `kalki-<svc>.<rest>`.
 *   3. Fall back to the localhost dev port.
 *
 * The "trustworthy" check rejects an env var that resolved to localhost
 * in a production environment, which is the failure mode we saw on the
 * deployed cluster — see the file header.
 */
function resolveBase(
  reqUrl: URL,
  fromEnv: string | undefined,
  svcPrefix: string,
  devFallback: string,
): string {
  if (fromEnv && !/localhost|127\.0\.0\.1/.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  // Try to derive from the request host. Works for any deployment that
  // names its services `kalki-<svc>.<rest>` (which is the helm
  // convention — see helm/kalki/templates/_helpers.tpl `kalki.host`).
  const host = reqUrl.hostname;
  const m = /^([a-z]+)-([a-z]+)\.(.+)$/.exec(host);
  if (m && m[1] === "kalki") {
    return `${reqUrl.protocol}//kalki-${svcPrefix}.${m[3]}`;
  }
  // Local dev fallback. NEXT_PUBLIC_* missing AND host doesn't match
  // the production pattern — likely `npm run dev`.
  return devFallback;
}

export async function POST(req: Request) {
  await clearSessionToken();
  await setLoggedOutFlag();

  const reqUrl = new URL(req.url);
  const exchangeBase = resolveBase(reqUrl, EXCHANGE_BASE_FROM_ENV, "bet", "http://localhost:3100");
  const aviatorBase = resolveBase(reqUrl, AVIATOR_BASE_FROM_ENV, "aviator", "http://localhost:3000");
  // Final landing follows the same pattern. In practice this is "us"
  // (auctions) so the request host is the right answer.
  const finalBase = resolveBase(reqUrl, FINAL_LANDING, "auctions", "http://localhost:3200");

  const finalUrl = `${finalBase}/login`;
  const aviatorStep = `${aviatorBase}/logout?next=${encodeURIComponent(finalUrl)}`;
  const betStep = `${exchangeBase}/api/auth/sso-logout?next=${encodeURIComponent(aviatorStep)}`;

  // 303 See Other — instructs the browser to issue a GET to `betStep`.
  return NextResponse.redirect(betStep, { status: 303 });
}
