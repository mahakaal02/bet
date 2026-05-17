'use client';

import { useRouter } from 'next/navigation';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';

/**
 * Wallet quick-actions panel in the Aviator UI. Two buttons:
 *
 *   - **Pay**: opens the Exchange wallet topup at `:3100/wallet` with
 *     the user's bearer token attached so the SSO middleware signs
 *     them in transparently. The previous Razorpay-inline flow was
 *     dropped — coin purchases should happen at the unified topup
 *     page, not embedded in every game.
 *
 *   - **Encash**: routes to `/withdraw` (Aviator's withdrawal form),
 *     but only when the wallet has enough balance to cover the minimum
 *     payout. Below the threshold the button is visibly disabled with
 *     a small hint so users don't click into the form just to be
 *     bounced. The form itself still enforces the same threshold
 *     server-side, this is the front-of-house guard.
 */
const WITHDRAW_MIN = 2_000;

/** Browser/emulator-aware exchange origin (matches lib/api.ts logic). */
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

  function clickPay() {
    // Hand off to the Exchange wallet — one canonical topup surface
    // serves all three games. Pass the bearer token so Bet's SSO
    // middleware signs the user in without a second prompt.
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
    <div className="glass rounded-2xl p-3 lg:rounded-3xl lg:p-5 space-y-2 lg:space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] lg:text-xs uppercase tracking-widest text-text-secondary">
            Wallet
          </div>
          <div className="font-mono text-xl lg:text-2xl font-extrabold leading-tight">
            ₹{walletBalance ?? '—'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clickPay}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-gradient-to-br from-[var(--color-accent-red)] to-[#FF7A59] hover:brightness-110 transition"
          >
            Pay
          </button>
          <button
            onClick={clickWithdraw}
            disabled={!canWithdraw}
            title={
              canWithdraw
                ? 'Withdraw to your bank / UPI'
                : `Reach ₹${WITHDRAW_MIN.toLocaleString('en-IN')} to enable withdrawals`
            }
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-[var(--color-neon-green)] to-[var(--color-neon-green-deep)] hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
          >
            Encash
          </button>
        </div>
      </div>

      {!canWithdraw && (
        <p className="text-[11px] text-text-secondary">
          Encash unlocks at ₹{WITHDRAW_MIN.toLocaleString('en-IN')} —
          you&apos;ve got {WITHDRAW_MIN - (walletBalance ?? 0)} more to go.
        </p>
      )}
    </div>
  );
}
