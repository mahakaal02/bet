'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { clearAuth, getUser, getToken } from '@/lib/auth';
import { useGame } from '@/lib/store';

/**
 * Account page for Aviator. Mirrors `auctions/app/profile/page.tsx`
 * and `bet/app/profile/page.tsx` — one button across all three games:
 *
 *   - Username + (best-effort) email pulled from the cached user blob.
 *   - Wallet balance from the live game store.
 *   - Sign-out triggers the same chain the other apps use: clear
 *     Aviator localStorage here, redirect through Bet's logout hop,
 *     then through Auctions' sso-logout hop, then land on the
 *     auctions /login.
 *
 * The chain is initiated CLIENT-side because Aviator's session lives
 * in localStorage — only browser JS can clear it. After cleanup we
 * hit Bet's SSO logout (clears NextAuth), then auctions' SSO logout
 * (clears `kalki_token`), then land on /login.
 *
 * Why the auctions hop is required: auctions /login redirects already-
 * signed-in users back to the hub `/`. Without clearing the auctions
 * cookie along the way, the chain ends with the user bounced right
 * back to the Kalki hub (= "logout doesn't work" from the user's
 * perspective).
 */
const EXCHANGE_BASE =
  process.env.NEXT_PUBLIC_EXCHANGE_URL ?? 'http://localhost:3100';
const AUCTIONS_BASE =
  process.env.NEXT_PUBLIC_AUCTIONS_URL ?? 'http://localhost:3200';

export default function AviatorProfilePage() {
  const router = useRouter();
  const balance = useGame((s) => s.balance);
  const [me, setMe] = useState<{ username: string; email?: string | null }>({
    username: '—',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || !getToken()) {
      // Aviator no longer has a standalone login page — bounce out to
      // the canonical login on the auctions host.
      window.location.replace(`${AUCTIONS_BASE.replace(/\/$/, '')}/login`);
      return;
    }
    setMe({ username: u.username, email: u.email ?? null });
  }, [router]);

  function signOutEverywhere() {
    setBusy(true);
    // 1. Clear Aviator's local storage *here* before kicking off the
    //    chain — if the user mashes back-button before the chain
    //    completes, at least Aviator is signed out locally.
    clearAuth();
    // 2. Build the chain BOTTOM-UP so each hop encodes the next:
    //      Bet sso-logout → Auctions sso-logout → Auctions /login
    //    The browser follows the 303 chain in order, clearing each
    //    cookie before landing on /login. Without the auctions hop,
    //    /login sees the live `kalki_token` cookie and bounces to
    //    `/` (the Kalki hub) — the symptom users reported as
    //    "clicking logout returns to the hub".
    const finalUrl = `${AUCTIONS_BASE.replace(/\/$/, '')}/login`;
    const auctionsStep = `${AUCTIONS_BASE.replace(/\/$/, '')}/api/auth/sso-logout?next=${encodeURIComponent(finalUrl)}`;
    const betStep = `${EXCHANGE_BASE.replace(/\/$/, '')}/api/auth/sso-logout?next=${encodeURIComponent(auctionsStep)}`;
    window.location.replace(betStep);
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          ← Back to Aviator
        </Link>

        <div className="mt-4 mb-6 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-divider bg-elevated text-2xl font-black text-text-primary">
            {(me.username ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight text-text-primary">
              @{me.username}
            </h1>
            <p className="text-sm text-text-secondary">
              {me.email ?? 'WhatsApp / email account'}
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-4 mb-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Account
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-primary">Unified wallet</span>
            <span className="font-mono text-sm font-semibold text-accent-orange">
              ₹{balance ?? '—'}
            </span>
          </div>
          <p className="text-[11px] text-text-secondary">
            Same balance across Auctions, Aviator, and Kalki Exchange.
          </p>
        </div>

        <div className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Sign out
          </h2>
          <p className="mb-3 text-sm text-text-primary">
            Signs you out of all three Kalki games and clears your session
            on this device.
          </p>
          <button
            type="button"
            onClick={signOutEverywhere}
            disabled={busy}
            className="rounded-lg border border-accent-red bg-accent-red/10 px-4 py-2 text-sm font-semibold text-accent-red hover:bg-accent-red/20 transition disabled:opacity-50"
          >
            {busy ? 'Signing out…' : 'Sign out of all games'}
          </button>
        </div>
      </div>
    </main>
  );
}
