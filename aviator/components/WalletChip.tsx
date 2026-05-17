'use client';

import { useState } from 'react';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';

/**
 * Wallet chip in the Aviator navbar — same visual + same destination
 * as the Auctions `TopupChip` and the Bet navbar wallet button. Tapping
 * opens Bet's `/wallet` page with the backend JWT attached, so the
 * Bet SSO middleware signs the user in transparently.
 *
 * Same browser-vs-emulator hostname trick as `lib/api.ts` — we pick the
 * exchange origin at click-time so the same bundle works whether the
 * user opened Aviator in a desktop browser (`localhost`), the Android
 * emulator (`10.0.2.2`), or a LAN device.
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

export default function WalletChip() {
  const balance = useGame((s) => s.balance);
  const [busy, setBusy] = useState(false);
  const empty = balance == null || balance <= 0;

  function open() {
    setBusy(true);
    const token = getToken();
    const base = `${exchangeOrigin()}/wallet`;
    window.location.href = token
      ? `${base}?token=${encodeURIComponent(token)}`
      : base;
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={empty ? 'Top up your wallet' : 'Manage wallet'}
      className={
        empty
          ? 'inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25 transition disabled:opacity-60'
          : 'inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15 transition disabled:opacity-60'
      }
    >
      ₹{(balance ?? 0).toLocaleString('en-IN')}
      <span className="ml-0.5 text-amber-300/80">›</span>
    </button>
  );
}
