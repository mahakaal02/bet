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
 *   3. Aviator forwards to the auctions /login.
 *
 * Why `signOut` first, then a manual `window.location.replace` to
 * Aviator: NextAuth's `signOut` is the canonical way to clear its
 * cookies, and `redirect: false` keeps it from racing our chain.
 */
const AVIATOR_BASE =
  process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000";
const AUCTIONS_BASE =
  process.env.NEXT_PUBLIC_AUCTIONS_URL ?? "http://localhost:3200";

export function SignOutCard() {
  const [busy, setBusy] = useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    await signOut({ redirect: false }).catch(() => {
      /* NextAuth occasionally throws on bad CSRF; cookie is gone either way. */
    });
    const finalUrl = `${AUCTIONS_BASE.replace(/\/$/, "")}/login`;
    const aviatorStep = `${AVIATOR_BASE.replace(/\/$/, "")}/logout?next=${encodeURIComponent(finalUrl)}`;
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
