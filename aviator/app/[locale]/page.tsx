'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAviator } from '@/lib/useAviator';
import { useGame } from '@/lib/store';
import { getToken, getUser, setToken, setUser, wasJustLoggedOut } from '@/lib/auth';
import type { AuthUser } from '@/lib/types';
import { useTranslation } from '@/lib/i18n/client';
import Navbar from '@/components/Navbar';
import Stage from '@/components/Stage';
import BetControls from '@/components/BetControls';
import HistoryStrip from '@/components/HistoryStrip';
import WalletPanel from '@/components/WalletPanel';
import RosterPanel from '@/components/RosterPanel';
import ChatPanel from '@/components/ChatPanel';
import WinnersPanel from '@/components/WinnersPanel';

/**
 * Main game page. Three-column desktop layout:
 *
 *   ┌──────────┬─────────────────────────────┬──────────┐
 *   │ Players  │ History rail               │ Winners  │
 *   │          │ ┌─────────────────────────┐│          │
 *   │ (roster) │ │ Stage (canvas + multi)  ││ (chat)   │
 *   │          │ └─────────────────────────┘│          │
 *   │          │ Bet controls               │          │
 *   │          │ Wallet                     │          │
 *   └──────────┴─────────────────────────────┴──────────┘
 *
 * On mobile the columns stack — the stage stays first so the player
 * always sees the active round above the fold, followed by bet
 * controls, then secondary panels.
 */
export default function GamePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <AuthGate />
    </Suspense>
  );
}

/**
 * Resolves the JWT before mounting any socket-using components.
 * WebView callers pass `?token=…`; if present we store it, decode
 * the payload for the navbar's display name, strip the URL, and
 * proceed.
 *
 * Without a token we bounce to the auctions login (port 3200) —
 * Aviator's standalone /login page is gone; user identity now
 * lives on the auctions backend and a single login surface owns it.
 *
 * Decoding the JWT for display is intentionally unverified — the
 * signature is the backend's problem; here we only need `username`
 * for the avatar initial.
 */
function AuthGate() {
  const params = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = params.get('token');
    if (t) {
      // PR-WEB-LOGOUT-FIX — if the user just explicitly signed out
      // (within the last 60s), DO NOT silently re-establish the
      // session from a `?token=…` URL param. Strip the token, bounce
      // to the auctions /login. Was the leading cause of the "I
      // signed out and revisiting auto-logs me in" complaint — a
      // hub tile / bookmark / stale page render still carried the
      // token in the URL.
      if (wasJustLoggedOut()) {
        window.history.replaceState({}, '', '/');
        window.location.replace(auctionsLoginUrl());
        return;
      }
      setToken(t);
      hydrateUserFromToken(t);
      window.history.replaceState({}, '', '/');
      setReady(true);
      return;
    }
    const existing = getToken();
    if (existing) {
      if (!getUser()) hydrateUserFromToken(existing);
      setReady(true);
    } else {
      window.location.replace(auctionsLoginUrl());
    }
  }, [params]);

  if (!ready) return <LoadingShell />;
  return <Game />;
}

function auctionsLoginUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3200/login';
  const fromEnv = process.env.NEXT_PUBLIC_AUCTIONS_URL;
  if (fromEnv) return `${fromEnv.replace(/\/$/, '')}/login`;
  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:3200/login`;
  }
  return 'http://localhost:3200/login';
}

function hydrateUserFromToken(token: string): void {
  try {
    const [, payload] = token.split('.');
    if (!payload) return;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const padded = pad === 0 ? b64 : b64 + '='.repeat(4 - pad);
    const claims = JSON.parse(atob(padded)) as Partial<AuthUser> & {
      sub?: string;
    };
    if (!claims.username) return;
    setUser({
      id: claims.id ?? claims.sub ?? '',
      email: claims.email ?? '',
      username: claims.username,
      emailVerified: claims.emailVerified ?? false,
      coinBalance: claims.coinBalance ?? 0,
      isAdmin: claims.isAdmin ?? false,
    });
  } catch {
    /* malformed token — leave user blob empty */
  }
}

function LoadingShell() {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-text-secondary text-sm">
        <div className="h-1 w-24 rounded-full bg-elevated overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-aurora-violet to-aurora-cyan animate-pulse" />
        </div>
        {t('game.connectingToArena')}
      </div>
    </main>
  );
}

function Game() {
  useAviator();
  const connected = useGame((s) => s.connected);
  const { t } = useTranslation();

  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 mx-auto w-full max-w-7xl px-3 py-3 lg:px-6 lg:py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-3 lg:gap-4">
          {/* Left column — players (hidden on mobile, surfaced via a
              future bottom-sheet if needed). */}
          <div className="hidden lg:flex lg:flex-col gap-4 order-2 lg:order-1">
            <RosterPanel />
          </div>

          {/* Centre column — the show. */}
          <div className="space-y-3 lg:space-y-4 order-1 lg:order-2 min-w-0">
            <HistoryStrip />
            <Stage />
            <BetControls />
            <WalletPanel />
            {/* Mobile-only: chat under the wallet so the social side
                of the round is still reachable without leaving the
                tab. Hidden on lg where it lives in the right rail. */}
            <div className="lg:hidden">
              <ChatPanel />
            </div>
            <div className="lg:hidden">
              <WinnersPanel />
            </div>
            <div className="lg:hidden">
              <RosterPanel />
            </div>
          </div>

          {/* Right column — chat + winners. */}
          <div className="hidden lg:flex lg:flex-col gap-4 order-3">
            <ChatPanel />
            <WinnersPanel />
          </div>
        </div>

        {!connected && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
            <div className="glass-strong rounded-full px-3 py-1.5 flex items-center gap-2 text-xs">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
              <span className="text-text-secondary">{t('game.reconnecting')}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
