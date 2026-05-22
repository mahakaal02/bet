'use client';

import { create } from 'zustand';
import { timeForMultiplier } from './curve';
import type {
  ActiveBet,
  ChatMessage,
  Phase,
  RecentWinner,
  RosterEntry,
  RoundHistoryEntry,
  StateSnapshot,
} from './types';

interface GameState {
  // connection
  connected: boolean;
  onlineCount: number;

  // current round
  phase: Phase;
  roundId: string | null;
  roundNumber: number | null;
  seedId: string | null;
  serverSeedHash: string | null;
  clientSeed: string | null;
  nonce: number | null;
  bettingEndsAt: number | null;
  startedAt: number | null;
  multiplier: number;
  lastCrash: { multiplier: number; roundNumber: number; serverSeed: string } | null;

  // user-scoped
  balance: number | null;        // alias of walletBalance, kept for Navbar
  walletBalance: number | null;  // INR wallet
  currentBet: ActiveBet | null;
  // "Let it ride": each round's default bet auto-updates from the previous
  // round's payout (₹100 on first round; payout on win; 0 on loss).
  nextStake: number;

  // feeds
  history: { roundNumber: number; crashMultiplier: number }[];
  recentWinners: RecentWinner[];
  chat: ChatMessage[];
  roster: RosterEntry[]; // bets placed on the current round

  // actions
  setConnected: (v: boolean) => void;
  setOnlineCount: (n: number) => void;
  applySnapshot: (s: StateSnapshot) => void;
  onGameStart: (e: {
    roundId: string;
    roundNumber: number;
    seedId?: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce?: number;
    bettingEndsAt: number;
  }) => void;
  onGameRunning: (e: { roundId: string; startedAt: number }) => void;
  onMultiplier: (m: number) => void;
  onCrash: (e: { roundNumber: number; crashMultiplier: number; serverSeed: string }) => void;
  setBalance: (n: number) => void;
  setWalletBalance: (n: number) => void;
  setNextStake: (n: number) => void;
  setCurrentBet: (b: ActiveBet | null) => void;
  setHistory: (rows: RoundHistoryEntry[]) => void;
  setRecentWinners: (w: RecentWinner[]) => void;
  appendWinner: (w: RecentWinner) => void;
  setChatHistory: (m: ChatMessage[]) => void;
  appendChat: (m: ChatMessage) => void;
  setRoster: (r: RosterEntry[]) => void;
  appendRoster: (r: RosterEntry) => void;
  markRosterCashout: (username: string, multiplier: number) => void;
}

export const useGame = create<GameState>((set) => ({
  connected: false,
  onlineCount: 0,
  phase: 'UNKNOWN',
  roundId: null,
  roundNumber: null,
  seedId: null,
  serverSeedHash: null,
  clientSeed: null,
  nonce: null,
  bettingEndsAt: null,
  startedAt: null,
  multiplier: 1.0,
  lastCrash: null,
  balance: null,
  walletBalance: null,
  currentBet: null,
  nextStake: 100,
  history: [],
  recentWinners: [],
  chat: [],
  roster: [],

  setConnected: (v) => set({ connected: v }),
  setOnlineCount: (n) => set({ onlineCount: n }),

  applySnapshot: (s) =>
    set(() => {
      // PR-AVIATOR-CLOCK-SKEW-ANCHOR — when joining mid-round, snapshot
      // includes both the server's `startedAt` and the server's
      // current `multiplier`. Trusting `startedAt` raw means a client
      // whose wall-clock differs from the server's will see the plane
      // animation desynced from the multiplier display.
      //
      // Instead we back-derive startedAt from the authoritative
      // multiplier reading: `Date.now() - timeForMultiplier(m)` is
      // the value of startedAt that makes our local clock agree with
      // the server's reported curve position. Plane lands exactly
      // where it should the very first frame.
      let startedAt = s.startedAt;
      if (s.phase === 'RUNNING' && s.multiplier && s.multiplier > 1.0) {
        startedAt = Date.now() - timeForMultiplier(s.multiplier);
      }
      return {
        phase: s.phase,
        roundId: s.roundId ?? null,
        roundNumber: s.roundNumber ?? null,
        seedId: s.seedId ?? null,
        serverSeedHash: s.serverSeedHash ?? null,
        clientSeed: s.clientSeed ?? null,
        nonce: s.nonce ?? null,
        bettingEndsAt: s.bettingEndsAt,
        startedAt,
        multiplier: s.multiplier ?? 1.0,
      };
    }),

  onGameStart: (e) =>
    set({
      phase: 'BETTING',
      roundId: e.roundId,
      roundNumber: e.roundNumber,
      seedId: e.seedId ?? null,
      serverSeedHash: e.serverSeedHash,
      clientSeed: e.clientSeed,
      nonce: e.nonce ?? null,
      bettingEndsAt: e.bettingEndsAt,
      startedAt: null,
      multiplier: 1.0,
      currentBet: null,
      lastCrash: null,
      roster: [], // bets are for the previous round; clear for this one
    }),

  onGameRunning: (e) =>
    set({
      phase: 'RUNNING',
      roundId: e.roundId,
      // PR-AVIATOR-CLOCK-SKEW-ANCHOR — at takeoff the multiplier IS
      // 1.0 (the round just started), so we treat receive-time as
      // start-time on the local clock. There's a small ~50ms network
      // hop the plane will visually lag the multiplier by during
      // this window; the first MULTIPLIER_UPDATE event corrects it
      // (see onMultiplier).
      //
      // Was: `startedAt: e.startedAt` (server's `Date.now()`). That
      // works only when client and server clocks agree. On a
      // skewed client (Android tablet, NTP-unsynced device) the
      // difference manifested as the plane sitting at the takeoff
      // position while the multiplier counted up — the plane was
      // waiting for the client's wall-clock to catch up to the
      // server's reported startedAt.
      startedAt: Date.now(),
      multiplier: 1.0,
    }),

  onMultiplier: (m) =>
    set((state) => {
      if (state.phase !== 'RUNNING' || state.startedAt == null) {
        return { multiplier: m };
      }
      // PR-AVIATOR-CLOCK-SKEW-ANCHOR — re-anchor startedAt to the
      // value that makes our local clock agree with the server's
      // authoritative multiplier. This runs on every MULTIPLIER_UPDATE
      // event (~50-150 ms cadence) and is effectively a continuous
      // clock-skew correction: if the two clocks agree, the re-anchor
      // is a no-op; if they drift, we snap into alignment without the
      // user noticing.
      //
      // Why this works: `timeForMultiplier(m)` inverts the shared
      // exponential curve to give us "how long after takeoff would
      // multiplier=m correspond to". `Date.now() - that` is the
      // value of startedAt that puts the plane exactly where the
      // server's reading says it should be on OUR clock.
      //
      // Skip the no-op case (multiplier=1.0 means takeoff just
      // happened — keep the existing anchor from onGameRunning).
      if (m <= 1.0) {
        return { multiplier: m };
      }
      const serverElapsedMs = timeForMultiplier(m);
      return {
        multiplier: m,
        startedAt: Date.now() - serverElapsedMs,
      };
    }),

  onCrash: (e) =>
    set((state) => ({
      phase: 'CRASHED',
      lastCrash: {
        multiplier: e.crashMultiplier,
        roundNumber: e.roundNumber,
        serverSeed: e.serverSeed,
      },
      history: [
        { roundNumber: e.roundNumber, crashMultiplier: e.crashMultiplier },
        ...state.history,
      ].slice(0, 30),
    })),

  setBalance: (n) => set({ balance: n, walletBalance: n }),
  setWalletBalance: (n) => set({ walletBalance: n, balance: n }),
  // "Let it ride" stake rule — floor at the platform minimum (100 coins)
  // so a loss resets back to the entry stake instead of zeroing out and
  // forcing the user to retype before they can bet again.
  setNextStake: (n) => set({ nextStake: Math.max(100, Math.floor(n)) }),
  setCurrentBet: (b) => set({ currentBet: b }),

  setHistory: (rows) =>
    set({
      history: rows.map((r) => ({
        roundNumber: r.roundNumber,
        crashMultiplier: Number(r.crashMultiplier),
      })),
    }),

  setRecentWinners: (w) => set({ recentWinners: w }),
  appendWinner: (w) =>
    set((state) => ({ recentWinners: [w, ...state.recentWinners].slice(0, 20) })),

  setChatHistory: (m) => set({ chat: m }),
  appendChat: (m) => set((state) => ({ chat: [...state.chat, m].slice(-100) })),

  setRoster: (r) => set({ roster: r }),
  appendRoster: (entry) =>
    set((state) => {
      // De-dupe by username — a user can only have one bet per round.
      const existing = state.roster.find((b) => b.username === entry.username);
      if (existing) return {};
      return { roster: [...state.roster, entry] };
    }),
  markRosterCashout: (username, multiplier) =>
    set((state) => ({
      roster: state.roster.map((b) =>
        b.username === username && b.cashedOutAt === null
          ? { ...b, cashedOutAt: multiplier }
          : b,
      ),
    })),
}));
