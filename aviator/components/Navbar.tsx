'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getUser, getToken } from '@/lib/auth';
import WalletChip from './WalletChip';

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
 * Aviator top bar. Same three-icon account row as auctions + Bet so
 * users see the same shape in every game:
 *
 *   Left:  horse logo + blue "Kalki" wordmark + "Aviator" pill
 *   Right: wallet chip · notifications bell · profile avatar
 *
 * Trimmed back from the earlier version — no fairness link, no online-
 * count, no inline balance. Those secondary widgets are reachable from
 * inside the game; the navbar stays focused on account-level controls
 * that mirror the other two surfaces.
 */
export default function Navbar() {
  // Username is read post-hydration only — getUser() touches localStorage
  // which is empty during SSR. Used for the profile-avatar initial.
  const [username, setUsername] = useState<string>('?');
  useEffect(() => {
    setUsername(getUser()?.username ?? '?');
  }, []);

  return (
    <header className="sticky top-0 z-20 backdrop-blur-md bg-bg/70 border-b border-divider">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3">
        {/* Logo tap → Kalki hub (auctions :3200/). Plain anchor because
            the hub is on a different origin; Next's <Link> would prefetch
            cross-origin which the browser won't honour anyway. */}
        <a
          href={hubUrl()}
          aria-label="Back to Kalki hub"
          className="flex items-center gap-2"
        >
          <Image
            src="/kalki-logo.png"
            alt="Kalki"
            width={32}
            height={32}
            priority
            className="rounded-lg"
          />
          <span className="text-lg font-black tracking-tight text-cyan-300">
            Kalki
          </span>
          <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
            Aviator
          </span>
        </a>
        <div className="flex items-center gap-2 text-sm">
          <WalletChip />
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="grid h-9 w-9 place-items-center rounded-lg border border-divider bg-elevated text-text-secondary hover:bg-surface hover:text-text-primary transition"
          >
            {/* Inline SVG to avoid pulling in lucide-react in Aviator's
                bundle for a single icon. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            title={username !== '?' ? `@${username}` : 'Profile'}
            className="grid h-9 w-9 place-items-center rounded-lg border border-divider bg-elevated text-text-secondary hover:bg-surface hover:text-text-primary transition"
          >
            {/* User-silhouette glyph — matches Bet's lucide `User` icon
                pixel-for-pixel so every game's profile button looks
                identical. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}
