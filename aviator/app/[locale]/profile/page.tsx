'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { clearAuth, getUser, getToken } from '@/lib/auth';
import { useGame } from '@/lib/store';
import { useTranslation } from '@/lib/i18n/client';

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
const EXCHANGE_BASE_ENV = process.env.NEXT_PUBLIC_EXCHANGE_URL;
const AUCTIONS_BASE_ENV = process.env.NEXT_PUBLIC_AUCTIONS_URL;

/**
 * PR-WEB-LOGOUT-FIX — resolve a base URL preferring the build-time
 * NEXT_PUBLIC_* env var, but falling back to a host derived from the
 * current `window.location` if the env var is missing OR looks like
 * the localhost dev default (which would 404 from a production page).
 *
 * The build pipeline normally sets these vars correctly
 * (.github/workflows/build-and-push.yml), but if a build ever ships
 * without them the previous code silently emitted localhost URLs in
 * the bundle — visible to users as a hard "site can't be reached"
 * error on the logout chain. Now the chain self-heals from the
 * request host pattern (`kalki-aviator.<rest>` → `kalki-<svc>.<rest>`).
 */
function resolveBase(fromEnv: string | undefined, svcPrefix: string, devFallback: string): string {
  if (fromEnv && !/localhost|127\.0\.0\.1/.test(fromEnv)) {
    return fromEnv.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const m = /^([a-z]+)-([a-z]+)\.(.+)$/.exec(window.location.hostname);
    if (m && m[1] === 'kalki') {
      return `${window.location.protocol}//kalki-${svcPrefix}.${m[3]}`;
    }
  }
  return devFallback;
}

export default function AviatorProfilePage() {
  const router = useRouter();
  const balance = useGame((s) => s.balance);
  const { t, locale } = useTranslation();
  const [me, setMe] = useState<{ username: string; email?: string | null }>({
    username: '—',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || !getToken()) {
      // Aviator no longer has a standalone login page — bounce out to
      // the canonical login on the auctions host.
      const auctionsBase = resolveBase(AUCTIONS_BASE_ENV, 'auctions', 'http://localhost:3200');
      window.location.replace(`${auctionsBase}/login`);
      return;
    }
    setMe({ username: u.username, email: u.email ?? null });
  }, [router]);

  function signOutEverywhere() {
    setBusy(true);
    // 1. Clear Aviator's local storage *here* before kicking off the
    //    chain — if the user mashes back-button before the chain
    //    completes, at least Aviator is signed out locally. This
    //    also stamps the just-logged-out flag (see lib/auth.ts) so
    //    the page-level AuthGate refuses a stale `?token=` URL
    //    param if the user revisits via a bookmark/tile soon after.
    clearAuth();
    // 2. Build the chain BOTTOM-UP so each hop encodes the next:
    //      Bet sso-logout → Auctions sso-logout → Auctions /login
    //    The browser follows the 303 chain in order, clearing each
    //    cookie before landing on /login. Without the auctions hop,
    //    /login sees the live `kalki_token` cookie and bounces to
    //    `/` (the Kalki hub) — the symptom users reported as
    //    "clicking logout returns to the hub".
    const exchangeBase = resolveBase(EXCHANGE_BASE_ENV, 'bet', 'http://localhost:3100');
    const auctionsBase = resolveBase(AUCTIONS_BASE_ENV, 'auctions', 'http://localhost:3200');
    const finalUrl = `${auctionsBase}/login`;
    const auctionsStep = `${auctionsBase}/api/auth/sso-logout?next=${encodeURIComponent(finalUrl)}`;
    const betStep = `${exchangeBase}/api/auth/sso-logout?next=${encodeURIComponent(auctionsStep)}`;
    window.location.replace(betStep);
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          {t('profile.backToAviator')}
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
              {me.email ?? t('profile.defaultEmail')}
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-4 mb-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t('profile.account')}
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-primary">{t('profile.unifiedWallet')}</span>
            <span className="font-mono text-sm font-semibold text-accent-orange">
              ₹{balance ?? '—'}
            </span>
          </div>
          <p className="text-[11px] text-text-secondary">
            {t('profile.unifiedNote')}
          </p>
        </div>

        <div className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t('profile.signOut')}
          </h2>
          <p className="mb-3 text-sm text-text-primary">
            {t('profile.signOutAllDescription')}
          </p>
          <button
            type="button"
            onClick={signOutEverywhere}
            disabled={busy}
            className="rounded-lg border border-accent-red bg-accent-red/10 px-4 py-2 text-sm font-semibold text-accent-red hover:bg-accent-red/20 transition disabled:opacity-50"
          >
            {busy ? t('profile.signingOut') : t('profile.signOutButton')}
          </button>
        </div>
      </div>
    </main>
  );
}
