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
