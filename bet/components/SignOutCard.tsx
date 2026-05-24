"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Card } from "@/components/ui/Card";

/**
 * Cross-app sign-out card. Used from the Bet profile page (and any
 * future "account" surface) — replaces the one-app logout button that
 * used to live in the navbar.
 *
 * Chain:
 *   1. Clear NextAuth session here via `signOut({redirect:false})`.
 *   2. Forward to Aviator's `/logout?next=…` (clears localStorage).
 *   3. Aviator forwards to Auctions' sso-logout (clears `kalki_token`).
 *   4. Auctions sso-logout 303s to /login.
 *
 * Why `signOut` first, then a manual `window.location.replace`:
 * NextAuth's `signOut` is the canonical way to clear its cookies, and
 * `redirect: false` keeps it from racing our chain.
 *
 * Why the auctions hop is required: auctions /login redirects already-
 * signed-in users back to the hub `/`. Without clearing the auctions
 * `kalki_token` cookie along the way, the chain ends with the user
 * bounced right back to the Kalki hub instead of seeing /login —
 * symptom users reported as "logout returns to the hub".
 */
const AVIATOR_BASE_ENV = process.env.NEXT_PUBLIC_AVIATOR_URL;
const AUCTIONS_BASE_ENV = process.env.NEXT_PUBLIC_AUCTIONS_URL;

/**
 * PR-WEB-LOGOUT-FIX — defensive base-URL resolver. Falls back to
 * deriving the host from `window.location` if the build-time env
 * var is missing or accidentally bundled as localhost (which would
 * cause a hard 404 from a production page on the logout chain).
 */
function resolveBase(fromEnv: string | undefined, svcPrefix: string, devFallback: string): string {
  if (fromEnv && !/localhost|127\.0\.0\.1/.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const m = /^([a-z]+)-([a-z]+)\.(.+)$/.exec(window.location.hostname);
    if (m && m[1] === "kalki") {
      return `${window.location.protocol}//kalki-${svcPrefix}.${m[3]}`;
    }
  }
  return devFallback;
}

export function SignOutCard() {
  const [busy, setBusy] = useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    await signOut({ redirect: false }).catch(() => {
      /* NextAuth occasionally throws on bad CSRF; cookie is gone either way. */
    });
    // Build the chain bottom-up so each hop encodes the next:
    //   Aviator /logout → Auctions sso-logout → Auctions /login
    const aviatorBase = resolveBase(AVIATOR_BASE_ENV, "aviator", "http://localhost:3000");
    const auctionsBase = resolveBase(AUCTIONS_BASE_ENV, "auctions", "http://localhost:3200");
    const finalUrl = `${auctionsBase}/login`;
    const auctionsStep = `${auctionsBase}/api/auth/sso-logout?next=${encodeURIComponent(finalUrl)}`;
    const aviatorStep = `${aviatorBase}/logout?next=${encodeURIComponent(auctionsStep)}`;
    window.location.replace(aviatorStep);
  }

  return (
    <Card>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Sign out
      </h2>
      <p className="mb-3 text-sm text-slate-300">
        Signs you out of all three Kalki games and clears your session on
        this device.
      </p>
      <button
        type="button"
        onClick={signOutEverywhere}
        disabled={busy}
        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out of all games"}
      </button>
    </Card>
  );
}
