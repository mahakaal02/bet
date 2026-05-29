'use client';

import { useEffect, useRef } from 'react';
import { api } from './api';
import { getUser } from './auth';
import { disconnectSocket, getSocket } from './socket';
import { useGame } from './store';
import type {
  ChatMessage,
  RecentWinner,
  RosterEntry,
  RoundHistoryEntry,
  StateSnapshot,
} from './types';

/**
 * Connects to socket.io, primes the store with REST data (balance + history),
 * and wires every server event into the Zustand store. Designed to be called
 * exactly once from the top-level game page.
 */
export function useAviator() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const game = useGame.getState();

    // Prime REST-backed state.
    void api
      .get<{ balance: number }>('/wallet/balance')
      .then((r) => game.setWalletBalance(r.balance))
      .catch(() => {});
    void api
      .get<RoundHistoryEntry[]>('/aviator/history?limit=20')
      .then((rows) => game.setHistory(rows))
      .catch(() => {});

    const sock = getSocket();

    sock.on('connect', () => {
      useGame.getState().setConnected(true);
      // Re-fetch the wallet on every (re)connect so a brief network
      // blip during a placeBet / cashout can't leave the displayed
      // balance drifting from the server. Cheap REST hit on the same
      // host the socket already opened to.
      void api
        .get<{ balance: number }>('/wallet/balance')
        .then((b) => useGame.getState().setWalletBalance(b.balance))
        .catch(() => {});
      // Server pushes a `STATE_SNAPSHOT` automatically on connect
      // (see `aviator.gateway.ts::handleConnection`), so the
      // multiplier + phase re-sync on reconnect is already handled
      // — we don't need to request one explicitly.
    });
    sock.on('disconnect', () => useGame.getState().setConnected(false));

    sock.on('STATE_SNAPSHOT', (s: StateSnapshot) => useGame.getState().applySnapshot(s));
    sock.on('ONLINE_COUNT', (e: { count: number }) =>
      useGame.getState().setOnlineCount(e.count),
    );
    sock.on('PLAYER_ROSTER', (r: RosterEntry[]) => useGame.getState().setRoster(r));
    sock.on('RECENT_WINNERS', (w: RecentWinner[]) => useGame.getState().setRecentWinners(w));
    sock.on('CHAT_HISTORY', (m: ChatMessage[]) => useGame.getState().setChatHistory(m));
    sock.on('CHAT_MESSAGE', (m: ChatMessage) => useGame.getState().appendChat(m));

    sock.on('GAME_START', (e) => useGame.getState().onGameStart(e));
    sock.on('GAME_RUNNING', (e) => useGame.getState().onGameRunning(e));
    sock.on('MULTIPLIER_UPDATE', (e: { multiplier: number }) =>
      useGame.getState().onMultiplier(e.multiplier),
    );
    // GAME_CRASH ends the round. Everything that must happen on a crash
    // lives in this single handler, in order:
    //   1. Snapshot whether the user lost (had an open bet that never
    //      cashed out) BEFORE the reducer runs — keeps loss-detection
    //      independent of whatever `onCrash` happens to mutate.
    //   2. Run the crash reducer (phase → CRASHED, push history).
    //   3. On a loss, apply the "let it ride" reset, then re-pull the
    //      authoritative wallet so the displayed balance can never drift
    //      from the server.
    // (Previously split across two separate GAME_CRASH listeners; merged
    // so the firing order is explicit and there's one source of truth.)
    sock.on('GAME_CRASH', (e) => {
      const state = useGame.getState();
      const lostRound =
        state.currentBet !== null && state.currentBet.cashedOutAt === null;
      state.onCrash(e);
      // `setNextStake` floors at the platform minimum (100 coins) — we
      // send 0 and it clamps up — so the next round starts with a
      // ready-to-bet default instead of an empty input the user has to
      // retype before they can place.
      if (lostRound) {
        useGame.getState().setNextStake(0);
      }
      void api
        .get<{ balance: number }>('/wallet/balance')
        .then((b) => useGame.getState().setWalletBalance(b.balance))
        .catch(() => {});
    });

    sock.on('PLAYER_BET', (e: { username: string; amount: number; autoCashoutAt: number | null }) =>
      useGame.getState().appendRoster({ ...e, cashedOutAt: null }),
    );
    sock.on('PLAYER_CASHOUT', (e: RecentWinner) => {
      const state = useGame.getState();
      // A pending settlement (server-side Bet credit failed) is NOT a
      // confirmed win: keep it out of the winners feed and don't seed
      // "let it ride" with coins that never landed. We still mark the
      // roster + local bet as cashed out — the cashout DID happen; only
      // the payout is awaiting admin reconciliation.
      if (!e.settlementPending) {
        state.appendWinner(e);
      }
      state.markRosterCashout(e.username, e.multiplier);
      const me = getUser()?.username;
      if (me && me === e.username) {
        if (state.currentBet) {
          state.setCurrentBet({
            ...state.currentBet,
            cashedOutAt: e.multiplier,
            // PR-AVIATOR-PAYOUT-CAP — propagate the server-side cap
            // flag so BetControls can render "MAX PAYOUT REACHED"
            // instead of the normal "CASHED OUT" chip. Old servers
            // (pre-cap) won't send `e.capped`; we omit the field on
            // the local bet rather than defaulting to false so
            // round-trip-equality checks elsewhere stay clean.
            ...(e.capped ? { cappedByPayoutCap: true } : {}),
          });
        }
        // "Let it ride" — next round's default bet = this round's
        // payout. Skip when the settlement is pending (payout is 0 and
        // unconfirmed); the next-stake reducer would just clamp to the
        // minimum anyway, but we avoid implying the coins arrived.
        if (!e.settlementPending) {
          state.setNextStake(e.payout);
        }
        // Use the API as source of truth (manual-cashout REST flow also
        // refreshes the wallet; optimistic increment here would double-count).
        void api
          .get<{ balance: number }>('/wallet/balance')
          .then((b) => useGame.getState().setWalletBalance(b.balance))
          .catch(() => {});
      }
    });

    return () => {
      sock.off('connect');
      sock.off('disconnect');
      sock.off('STATE_SNAPSHOT');
      sock.off('ONLINE_COUNT');
      sock.off('GAME_START');
      sock.off('GAME_RUNNING');
      sock.off('MULTIPLIER_UPDATE');
      sock.off('GAME_CRASH');
      sock.off('PLAYER_BET');
      sock.off('PLAYER_CASHOUT');
      sock.off('PLAYER_ROSTER');
      sock.off('RECENT_WINNERS');
      sock.off('CHAT_HISTORY');
      sock.off('CHAT_MESSAGE');
      disconnectSocket();
      started.current = false;
    };
  }, []);
}
