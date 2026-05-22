'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getUser, getToken } from '@/lib/auth';
import { useGame } from '@/lib/store';
import WalletChip from './WalletChip';
import StatsModal from './StatsModal';

/**
 * Resolve the Kalki hub URL with the bearer token attached, so a logo
 * tap from Aviator lands the user signed-in on the hub. Same host-
 * detection trick as the rest of the app — works in browser, Android
 * emulator, and LAN.
 */
function hubUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_AUCTIONS_URL;
  let base = 'http://localhost:3200';
  if (fromEnv) base = fromEnv.replace(/\/$/, '');
  else if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      base = `http://${host}:3200`;
    }
  }
  const token = typeof window !== 'undefined' ? getToken() : null;
  return token ? `${base}/?token=${encodeURIComponent(token)}` : `${base}/`;
}

/**
 * Top bar — three zones: brand mark · live-status badge · account
 * controls. Visually flatter than the previous version (no inline
 * gradient pill on "Aviator"), more consistent with the rest of the
 * Aurora system.
 */
export default function Navbar() {
  const [username, setUsername] = useState<string>('?');
  const [statsOpen, setStatsOpen] = useState(false);
  useEffect(() => {
    setUsername(getUser()?.username ?? '?');
  }, []);

  const onlineCount = useGame((s) => s.onlineCount);
  const connected = useGame((s) => s.connected);

  return (
    <>
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-bg/70 border-b border-divider">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 lg:px-6 py-2.5">
        <a
          href={hubUrl()}
          aria-label="Back to Kalki hub"
          className="flex items-center gap-2.5 chip-press"
        >
          <Image
            src="/kalki-logo.png"
            alt="Kalki"
            width={30}
            height={30}
            priority
            className="rounded-lg"
          />
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-aurora-cyan to-aurora-violet">
              Kalki
            </span>
            <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">
              Aviator
            </span>
          </div>
        </a>

        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-divider bg-elevated/40">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-success glow-breath' : 'bg-danger'
            }`}
            style={{
              boxShadow: connected ? '0 0 6px #22E0BD' : '0 0 6px #FF4D6D',
            }}
          />
          <span className="text-[11px] font-bold text-text-secondary tabular-nums">
            {onlineCount} online
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <WalletChip />
          {/* My-stats button. Bar-chart icon, opens the StatsModal
              with Day/Week/Month/All tabs. Sits next to Notifications
              so the navbar still reads as "wallet · alerts · me". */}
          <button
            type="button"
            onClick={() => setStatsOpen(true)}
            aria-label="My stats"
            title="My stats"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-elevated/60 text-text-secondary hover:bg-elevated hover:text-text-primary chip-press transition"
          >
            <svg
              width="16" height="16"
              viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden
            >
              <line x1="6" y1="20" x2="6" y2="14" />
              <line x1="12" y1="20" x2="12" y2="8" />
              <line x1="18" y1="20" x2="18" y2="11" />
              <line x1="3" y1="20" x2="21" y2="20" />
            </svg>
          </button>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-elevated/60 text-text-secondary hover:bg-elevated hover:text-text-primary chip-press transition"
          >
            <svg
              width="16" height="16"
              viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            title={username !== '?' ? `@${username}` : 'Profile'}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-elevated/60 text-text-secondary hover:bg-elevated hover:text-text-primary chip-press transition"
          >
            <svg
              width="16" height="16"
              viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
    <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
    </>
  );
}
