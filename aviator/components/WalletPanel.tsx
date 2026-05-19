'use client';

import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';
import { formatCoins } from '@/lib/format';

/**
 * Wallet quick-actions panel — premium glass card with two CTAs.
 *
 *   Top up  →  hands off to the Exchange wallet (`:3100/wallet`)
 *              with the user's bearer token attached so the SSO
 *              middleware signs them in transparently.
 *
 *   Encash  →  routes to the Exchange wallet's withdrawal page
 *              (`:3100/wallet/withdraw`), again token-passing.
 *              The Aviator backend doesn't expose `/wallet/withdraw`
 *              (it's on Bet, the canonical wallet) — the previous
 *              standalone Aviator withdraw form 404'd because of
 *              that mismatch. Routing to Bet's existing page is
 *              both the correct surface and avoids duplicating
 *              the form logic in two apps.
 *
 * Withdrawal lock kicks in below the platform minimum (100 coins,
 * matching `MIN_WITHDRAW_COINS` in `bet/lib/coins.ts`). Below the
 * threshold the button is visibly disabled with a progress bar
 * counting down the gap.
 */
const WITHDRAW_MIN = 100;

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

function exchangeUrl(path: string): string {
  const token = getToken();
  const base = `${exchangeOrigin()}${path}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export default function WalletPanel() {
  const walletBalance = useGame((s) => s.walletBalance);
  const canWithdraw = (walletBalance ?? 0) >= WITHDRAW_MIN;
  const remaining = Math.max(0, WITHDRAW_MIN - (walletBalance ?? 0));
  const pct = canWithdraw
    ? 100
    : Math.min(100, Math.round(((walletBalance ?? 0) / WITHDRAW_MIN) * 100));

  function clickPay() {
    window.location.href = exchangeUrl('/wallet');
  }

  function clickWithdraw() {
    if (!canWithdraw) return;
    window.location.href = exchangeUrl('/wallet/withdraw');
  }

  return (
    <div className="glass rounded-3xl p-4 lg:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-text-secondary">
            Wallet balance
          </div>
          <div className="font-mono text-2xl lg:text-3xl font-black leading-tight text-text-primary tabular-nums">
            {formatCoins(walletBalance)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clickPay}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-br from-aurora-violet to-[#5C2BFF] hover:brightness-110 transition chip-press shadow-card"
          >
            + Top up
          </button>
          <button
            onClick={clickWithdraw}
            disabled={!canWithdraw}
            title={
              canWithdraw
                ? 'Withdraw to your bank / UPI'
                : `Reach ${formatCoins(WITHDRAW_MIN)} to enable withdrawals`
            }
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-br from-success to-[#10A38A] hover:brightness-110 transition chip-press shadow-card disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:brightness-100"
          >
            Encash
          </button>
        </div>
      </div>

      {!canWithdraw && (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-aurora-violet to-success transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-text-secondary">
            Encash unlocks at {formatCoins(WITHDRAW_MIN)} — {formatCoins(remaining)} to go.
          </p>
        </div>
      )}
    </div>
  );
}
