'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAviator } from '@/lib/useAviator';
import { useGame } from '@/lib/store';
import { getToken, getUser, setToken, setUser } from '@/lib/auth';
import type { AuthUser } from '@/lib/types';
import Navbar from '@/components/Navbar';
// `Stage` is a feature-flagged wrapper that picks PlaneStage or
// RocketStage based on `NEXT_PUBLIC_AVIATOR_ROCKET`. Direct import of
// PlaneStage is gone so the unused branch tree-shakes correctly.
import Stage from '@/components/Stage';
import BetControls from '@/components/BetControls';
import WalletPanel from '@/components/WalletPanel';
import RosterPanel from '@/components/RosterPanel';
import ChatPanel from '@/components/ChatPanel';
import WinnersPanel from '@/components/WinnersPanel';

export default function GamePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <AuthGate />
    </Suspense>
  );
}

/**
 * Resolves the JWT before mounting any socket-using components. WebView
 * callers pass `?token=…`; if present we store it, decode the payload
 * for the navbar's display name, strip the URL, and proceed.
 *
 * Without a token we bounce to the auctions login (port 3200) —
 * Aviator's old standalone /login page is gone; user identity now
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
      setToken(t);
      hydrateUserFromToken(t);
      // Strip the token from the URL bar (and avoid re-running the effect).
      window.history.replaceState({}, '', '/');
      setReady(true);
      return;
    }
    const existing = getToken();
    if (existing) {
      // Cold reload with a stored token but no cached user blob — that
      // can happen after a localStorage user wipe. Re-hydrate from the
      // JWT so the navbar avatar shows the right initial.
      if (!getUser()) hydrateUserFromToken(existing);
      setReady(true);
    } else {
      window.location.replace(auctionsLoginUrl());
    }
  }, [params]);

  if (!ready) return <LoadingShell />;
  return <Game />;
}

/**
 * Resolve the auctions login URL — bounced to whenever Aviator is
 * opened without a token. Handles both the desktop-browser case
 * (`localhost:3200`) and the Android emulator case (`10.0.2.2:3200`).
 */
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

/**
 * Decode the JWT payload (no signature check) to extract `username`
 * and `email`, then cache as the user blob so `getUser()` returns
 * something for the navbar avatar. The backend has already vouched
 * for this token by the time it lands here.
 */
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
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-text-secondary text-sm">Loading…</div>
    </main>
  );
}

function Game() {
  useAviator();

  const phase = useGame((s) => s.phase);

  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />
      <div
        className={`flex-1 mx-auto w-full max-w-7xl px-3 py-3 lg:px-4 lg:py-6 ${
          phase === 'CRASHED' ? 'screen-shake' : ''
        }`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-3 lg:gap-4">
          <div className="hidden lg:block lg:order-1 space-y-4">
            <RosterPanel />
          </div>

          <div className="space-y-3 lg:space-y-4 order-1 lg:order-2 min-w-0">
            <section className="glass rounded-2xl px-3 py-2 lg:rounded-3xl lg:px-4 lg:py-3">
              <div className="flex items-center justify-center text-xs text-text-secondary">
                <span
                  className={`font-mono uppercase tracking-[0.25em] ${
                    phase === 'BETTING'
                      ? 'text-accent-orange'
                      : phase === 'RUNNING'
                      ? 'text-neon-green'
                      : phase === 'CRASHED'
                      ? 'text-accent-red'
                      : 'text-text-secondary'
                  }`}
                >
                  {phase}
                </span>
              </div>

              <Stage />
            </section>

            <BetControls />
            <WalletPanel />
          </div>

          <div className="hidden lg:block lg:order-3 space-y-4">
            <ChatPanel />
            <WinnersPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
