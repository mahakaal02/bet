export type Phase = 'BETTING' | 'RUNNING' | 'CRASHED' | 'UNKNOWN';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  emailVerified: boolean;
  coinBalance: number;
  isAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface RoundIdentity {
  roundId: string;
  roundNumber: number;
  seedId?: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce?: number;
}

export interface ActiveBet {
  betId: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null; // captured multiplier on cashout
  /**
   * PR-AVIATOR-PAYOUT-CAP — true if this bet was settled by the
   * server's payout-cap auto-cashout (or the manual cashout would
   * have exceeded the cap and got clipped). The UI uses this to
   * render "MAX PAYOUT REACHED" instead of the normal "CASHED OUT".
   * Optional so older state-snapshot payloads (pre-cap) deserialise
   * cleanly.
   */
  cappedByPayoutCap?: boolean;
}

export interface RoundHistoryEntry {
  id: string;
  roundNumber: number;
  crashMultiplier: string;
  nonce?: number | null;
  seedId?: string | null;
  serverSeedHash: string;
  clientSeed: string;
  crashedAt: string | null;
}

export interface RecentWinner {
  username: string;
  multiplier: number;
  payout: number;
  roundNumber: number;
  at: number;
  /**
   * PR-AVIATOR-PAYOUT-CAP — only present when the player was
   * settled by the cap (server-side). Old clients ignore the flag
   * and render the normal cashout chip. The payout field already
   * carries the CAPPED amount (not the would-be payout); UI that
   * wants to show "could have won X" reads `originalPayout`.
   */
  capped?: boolean;
  originalPayout?: number;
  payoutCapCoins?: number;
  /**
   * Set when the server marked the cashout but the Bet wallet credit
   * failed (network glitch / wallet offline). The payout is reported
   * as 0 and the entry is kept out of the public winners feed; an
   * admin reconciles the missing credit from WalletTransaction rows.
   */
  settlementPending?: boolean;
}

export interface RosterEntry {
  username: string;
  amount: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null; // captured multiplier on cashout
}

export interface ChatMessage {
  id: string;
  username: string;
  message: string;
  createdAt: string;
}

export interface StateSnapshot {
  phase: Phase;
  roundId?: string;
  roundNumber?: number;
  seedId?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  nonce?: number;
  bettingEndsAt: number | null;
  startedAt: number | null;
  multiplier: number | null;
}
