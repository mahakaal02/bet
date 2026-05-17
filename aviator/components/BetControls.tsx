'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useGame } from '@/lib/store';
import { useTopup } from '@/lib/useTopup';

interface PlaceBidResp {
  betId: string;
  amount: number;
  autoCashoutAt: number | null;
}

interface CashoutResp {
  multiplier: number;
  payout: number;
}

export default function BetControls() {
  const phase = useGame((s) => s.phase);
  const balance = useGame((s) => s.balance);
  const currentBet = useGame((s) => s.currentBet);
  const setCurrentBet = useGame((s) => s.setCurrentBet);
  const setBalance = useGame((s) => s.setBalance);
  const liveMultiplier = useGame((s) => s.multiplier);
  const nextStake = useGame((s) => s.nextStake);
  const { topup, busy: topupBusy } = useTopup();

  const [amount, setAmount] = useState<number>(nextStake);
  const [autoAt, setAutoAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // When a new BETTING phase begins, sync the input to the running stake
  // (first round = ₹100; after a win = payout; after a loss = 0).
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current !== 'BETTING' && phase === 'BETTING') {
      setAmount(nextStake);
    }
    lastPhase.current = phase;
  }, [phase, nextStake]);

  // Also reflect a fresh stake while we're still in BETTING (e.g. just won
  // an auto-cashout but the round is already over and the next BETTING began
  // before the user re-opened the page).
  useEffect(() => {
    if (phase === 'BETTING' && !currentBet) {
      setAmount(nextStake);
    }
  }, [nextStake]); // eslint-disable-line react-hooks/exhaustive-deps

  async function placeBet() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const auto = autoAt.trim() ? Number(autoAt) : null;
      if (auto !== null && (isNaN(auto) || auto < 1.01)) {
        throw new Error('auto cashout must be ≥ 1.01');
      }
      if (amount <= 0) {
        throw new Error('amount must be ≥ 1');
      }
      if (balance !== null && amount > balance) {
        throw new Error(`insufficient wallet (₹${balance})`);
      }
      const res = await api.post<PlaceBidResp>('/aviator/bet', {
        amount,
        ...(auto !== null ? { autoCashoutAt: auto } : {}),
      });
      setCurrentBet({
        betId: res.betId,
        amount: res.amount,
        autoCashoutAt: res.autoCashoutAt,
        cashedOutAt: null,
      });
      if (balance !== null) setBalance(balance - res.amount);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Insufficient-balance shortcut. Opens Razorpay with a top-up amount
   * rounded up to the nearest ₹100 that covers `amount - balance`, then
   * (if the round is still in BETTING when the payment lands) auto-places
   * the bet the user originally tried to make. If they dismiss Razorpay
   * we leave them on the bet screen with their input intact.
   */
  async function topupThenBet() {
    if (balance === null) return;
    const needed = Math.max(0, amount - balance);
    const requested = Math.max(100, Math.ceil(needed / 100) * 100);
    setError(null);
    setNotice(null);
    const result = await topup(requested, {
      description: `Top up ₹${requested} to play ₹${amount}`,
    });
    if (result.dismissed) return;
    if (!result.ok) {
      setError(result.error ?? 'top-up failed');
      return;
    }
    setNotice(`Added ₹${result.credited}. Placing bet…`);
    // Phase may have advanced while the user was in the Razorpay sheet.
    // If we're back to BETTING (or still in it), auto-place; otherwise
    // leave the amount loaded for the next round.
    if (phase === 'BETTING' && !currentBet) {
      await placeBet();
    }
  }

  async function cashout() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CashoutResp>('/aviator/cashout', {});
      setCurrentBet(
        currentBet
          ? { ...currentBet, cashedOutAt: res.multiplier }
          : null,
      );
      // The PLAYER_CASHOUT broadcast handler refreshes wallet + nextStake.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cashedOut = currentBet?.cashedOutAt != null;
  const insufficient = balance !== null && amount > balance;
  const canBet =
    phase === 'BETTING' && !currentBet && !busy && balance !== null && amount > 0 && amount <= balance;
  const canCashOut = phase === 'RUNNING' && currentBet && !cashedOut && !busy;
  // Amount we'd ask Razorpay for in the in-game shortcut: rounded up to the
  // nearest ₹100 that covers the shortfall. ₹100 is the Razorpay-side
  // minimum, so even a ₹1 gap triggers a ₹100 top-up.
  const topupNeeded = balance === null
    ? 0
    : Math.max(100, Math.ceil(Math.max(0, amount - balance) / 100) * 100);
  const canTopupToBet =
    phase === 'BETTING' &&
    !currentBet &&
    !busy &&
    !topupBusy &&
    insufficient &&
    amount > 0;

  return (
    <div className="glass rounded-2xl p-3 lg:rounded-3xl lg:p-6 grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 items-end">
      <div>
        <label className="text-[10px] lg:text-xs uppercase tracking-widest text-text-secondary">
          Bet amount (₹)
        </label>
        <div className="flex items-stretch gap-2 mt-1">
          <button
            type="button"
            onClick={() => setAmount((a) => Math.max(0, a - 50))}
            className="px-3 rounded-lg bg-elevated border border-divider hover:bg-surface transition"
            disabled={!!currentBet}
          >
            −
          </button>
          <input
            type="number"
            min={0}
            max={100000}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className={`flex-1 bg-elevated border rounded-lg px-3 py-2 font-mono text-sm outline-none ${
              insufficient ? 'border-accent-red' : 'border-divider focus:border-accent-orange'
            }`}
            disabled={!!currentBet}
          />
          <button
            type="button"
            onClick={() => setAmount((a) => a + 50)}
            className="px-3 rounded-lg bg-elevated border border-divider hover:bg-surface transition"
            disabled={!!currentBet}
          >
            +
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] lg:text-xs uppercase tracking-widest text-text-secondary">
          Auto cashout (×)
        </label>
        <input
          type="text"
          placeholder="e.g. 2.00"
          value={autoAt}
          onChange={(e) => setAutoAt(e.target.value)}
          className="mt-1 w-full bg-elevated border border-divider rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-accent-orange"
          disabled={!!currentBet}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {!currentBet || cashedOut ? (
          insufficient && phase === 'BETTING' ? (
            <button
              onClick={topupThenBet}
              disabled={!canTopupToBet}
              className="rounded-xl py-3 font-bold text-white bg-gradient-to-br from-[var(--color-neon-green)] to-[var(--color-neon-green-deep)] hover:brightness-110 transition disabled:opacity-40"
            >
              {topupBusy ? '…' : `ADD ₹${topupNeeded} & BET`}
            </button>
          ) : (
            <button
              onClick={placeBet}
              disabled={!canBet}
              className="rounded-xl py-3 font-bold text-white bg-gradient-to-br from-[var(--color-accent-red)] to-[#FF7A59] hover:brightness-110 transition disabled:opacity-40"
            >
              {phase === 'BETTING'
                ? amount > 0 ? `PLACE BET · ₹${amount}` : 'PLACE BET'
                : 'WAITING…'}
            </button>
          )
        ) : phase === 'RUNNING' ? (
          <button
            onClick={cashout}
            disabled={!canCashOut}
            className="cashout-pulse rounded-xl py-3 font-bold text-white bg-gradient-to-br from-[var(--color-neon-green)] to-[var(--color-neon-green-deep)] disabled:opacity-40 disabled:animate-none"
          >
            CASHOUT ₹{Math.floor(currentBet.amount * liveMultiplier)} @ {liveMultiplier.toFixed(2)}×
          </button>
        ) : phase === 'CRASHED' && !cashedOut ? (
          <button
            disabled
            className="rounded-xl py-3 font-bold text-white bg-gradient-to-br from-[#5B1A1F] to-[#7A222C] opacity-90"
          >
            BUSTED  −₹{currentBet.amount}
          </button>
        ) : (
          <button disabled className="rounded-xl py-3 font-bold text-white bg-elevated opacity-60">
            BET LOCKED
          </button>
        )}
        {error && <p className="text-xs text-accent-red">{error}</p>}
        {!error && notice && <p className="text-xs text-neon-green">{notice}</p>}
        {!error && !notice && insufficient && (
          <p className="text-xs text-accent-red">
            Wallet ₹{balance ?? 0}. Tap to add ₹{topupNeeded} and bet ₹{amount}.
          </p>
        )}
        {currentBet && cashedOut && (
          <p className="text-xs text-neon-green">
            Cashed out @ {currentBet.cashedOutAt?.toFixed(2)}× · +₹
            {Math.floor(currentBet.amount * (currentBet.cashedOutAt ?? 1))}
          </p>
        )}
      </div>
    </div>
  );
}
