'use client';

import { useEffect } from 'react';
import { getToken } from '@/lib/auth';

/**
 * Withdrawal — bounces straight to the Exchange wallet's withdraw
 * form at `:3100/wallet/withdraw` with the bearer token attached
 * for SSO. The previous standalone form here was 404'ing because
 * the Aviator NestJS backend doesn't expose `POST /wallet/withdraw`
 * (it lives on Bet's Next.js wallet — see `bet/app/api/wallet/
 * withdraw/route.ts`). Routing the user to the right surface
 * (instead of duplicating the form logic in two apps with two
 * different validation rules) is the cleanest fix.
 *
 * Renders a brief redirect-state card while the navigation kicks in
 * — keeps the page from flashing as a blank white frame in the
 * Android WebView.
 */
function exchangeOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EXCHANGE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:3100`;
    }
  }
  return 'http://localhost:3100';
}

export default function WithdrawRedirect() {
  useEffect(() => {
    const token = getToken();
    const base = `${exchangeOrigin()}/wallet/withdraw`;
    const dest = token
      ? `${base}?token=${encodeURIComponent(token)}`
      : base;
    // Use `replace` so the redirect doesn't pollute the back stack —
    // tapping back from the Exchange wallet returns to the game, not
    // to this transitional page.
    window.location.replace(dest);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="glass rounded-3xl p-6 max-w-sm w-full text-center space-y-3">
        <div className="mx-auto h-1 w-24 rounded-full bg-elevated overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-aurora-violet to-aurora-cyan animate-pulse" />
        </div>
        <h1 className="text-base font-bold text-text-primary">
          Opening withdrawal…
        </h1>
        <p className="text-xs text-text-secondary">
          Redirecting to the Kalki wallet to submit your request.
        </p>
      </div>
    </main>
  );
}
