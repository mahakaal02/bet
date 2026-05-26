'use client';

import { useState } from 'react';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';
import { formatCoins } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/client';

/**
 * Compact wallet chip in the navbar. Tap → Exchange top-up at
 * `:3100/wallet` (token attached so SSO signs in transparently).
 *
 * Empty-state amber chip nudges new users to top up. Once funded
 * it flips to a neutral cool chip so the eye gravitates to the
 * stage and not the bank.
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
  const { t } = useTranslation();

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
      title={empty ? t('wallet.topUpTitle') : t('wallet.manageWallet')}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold border chip-press transition disabled:opacity-60 ${
        empty
          ? 'border-warning/40 bg-warning/15 text-warning hover:bg-warning/25'
          : 'border-aurora-violet/30 bg-aurora-violet/10 text-aurora-violet hover:bg-aurora-violet/20'
      }`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: empty ? '#FF8A3D' : '#8B5CFF',
          boxShadow: `0 0 6px ${empty ? '#FF8A3D' : '#8B5CFF'}`,
        }}
      />
      <span className="font-mono tabular-nums">{formatCoins(balance, { compact: true })}</span>
    </button>
  );
}
