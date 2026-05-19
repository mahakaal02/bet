'use client';

import { useRouter } from 'next/navigation';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';
import { formatRupees } from '@/lib/format';

/**
 * Wallet quick-actions panel — premium glass card with two CTAs.
 *
 *   Pay     →  hands off to the Exchange wallet (`:3100/wallet`)
 *              with the user's bearer token attached so the SSO
 *              middleware signs them in transparently.
 *
 *   Encash  →  routes to Aviator's `/withdraw` form, but only
 *              after the wallet balance crosses the `WITHDRAW_MIN`
 *              threshold. Below the threshold the button visibly
 *              disables and a hint surfaces the gap; the form itself
 *              still enforces the same threshold server-side.
 *
 * Visual changes vs. the previous version: full-width buttons inside
 * a single card with a bold balance readout above. Withdrawal-locked
 * state shows a slim progress bar so the player feels the gap close.
 */
const WITHDRAW_MIN = 2_000;

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

export default function WalletPanel() {
  const router = useRouter();
  const walletBalance = useGame((s) => s.walletBalance);
  const canWithdraw = (walletBalance ?? 0) >= WITHDRAW_MIN;
  const remaining = Math.max(0, WITHDRAW_MIN - (walletBalance ?? 0));
  const pct = canWithdraw
    ? 100
    : Math.min(100, Math.round(((walletBalance ?? 0) / WITHDRAW_MIN) * 100));

  function clickPay() {
    const token = getToken();
    const base = `${exchangeOrigin()}/wallet`;
    window.location.href = token
      ? `${base}?token=${encodeURIComponent(token)}`
      : base;
  }

  function clickWithdraw() {
    if (!canWithdraw) return;
    router.push('/withdraw');
  }

  return (
    <div className="glass rounded-3xl p-4 lg:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-text-secondary">
            Wallet balance
          </div>
          <div className="font-mono text-2xl lg:text-3xl font-black leading-tight text-text-primary tabular-nums">
            {formatRupees(walletBalance)}
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
                : `Reach ${formatRupees(WITHDRAW_MIN)} to enable withdrawals`
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
            Encash unlocks at {formatRupees(WITHDRAW_MIN)} — {formatRupees(remaining)} to go.
          </p>
        </div>
      )}
    </div>
  );
}
