import { NextResponse } from "next/server";
import { clearSessionToken } from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 * Single sign-out across all three Kalki games. Each app owns its own
 * session technology (cookie here, NextAuth cookie on Bet, localStorage
 * on Aviator), and same-origin policies forbid one app from reaching
 * into another's storage. The chain works around that by hopping the
 * user's browser through each origin's logout endpoint:
 *
 *   1. (here) clear the auctions `kalki_token` cookie.
 *   2. 303 → `:3100/api/auth/sso-logout?next=…`  (Bet clears its cookie)
 *   3. 303 → `:3000/logout?next=…`               (Aviator clears localStorage)
 *   4. 303 → `:3200/login`                       (back to app login)
 *
 * If any hop is offline the chain breaks and the user lands somewhere
 * with a mixed state, but for dev that's acceptable — production would
 * front all three behind one origin or use a single OIDC provider.
 */

const FINAL_LANDING = process.env.NEXT_PUBLIC_AUCTIONS_URL ?? "http://localhost:3200";
const EXCHANGE_BASE = process.env.NEXT_PUBLIC_EXCHANGE_URL ?? "http://localhost:3100";
const AVIATOR_BASE = process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000";

export async function POST() {
  await clearSessionToken();

  const finalUrl = `${FINAL_LANDING.replace(/\/$/, "")}/login`;
  const aviatorStep = `${AVIATOR_BASE.replace(/\/$/, "")}/logout?next=${encodeURIComponent(finalUrl)}`;
  const betStep = `${EXCHANGE_BASE.replace(/\/$/, "")}/api/auth/sso-logout?next=${encodeURIComponent(aviatorStep)}`;

  // 303 See Other — instructs the browser to issue a GET to `betStep`.
  return NextResponse.redirect(betStep, { status: 303 });
}
