'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useGame } from '@/lib/store';
import { useTopup } from '@/lib/useTopup';
import { tierFor } from '@/lib/tiers';
import { formatRupees } from '@/lib/format';

/**
 * Bet controls — the player's primary action surface. Three logical
 * states map to three big-button presentations:
 *
 *   BETTING + no bet            →  PLACE BET ₹{amount}  (violet)
 *   BETTING + insufficient      →  ADD ₹X & BET         (mint, "topup-then-bet")
 *   RUNNING + live bet          →  CASHOUT ₹{liveProfit} @ {m}× (mint pulse, tier-tinted)
 *   CRASHED + lost bet          →  BUSTED -₹{amount}     (red, locked)
 *   any +  cashed out           →  WAITING…              (locked)
 *
 * Around that hero button we surface:
 *   - Amount input with quick chips (+₹50, +₹100, ½, 2×) and stepper
 *   - Auto-cashout toggle + target picker (1.5×, 2×, 5×, custom)
 *   - Inline error / success banner under the button
 *
 * The bet + cashout REST calls and the "let it ride" stake rule are
 * unchanged from the previous version — the redesign is purely
 * presentation. Behaviour invariants preserved: only one bet per
 * round, auto-cashout target validated ≥1.01, insufficient-balance
 * topup flow, optimistic balance decrement on placeBet.
 */

interface PlaceBidResp {
  betId: string;
  amount: number;
  autoCashoutAt: number | null;
}

interface CashoutResp {
  multiplier: number;
  payout: number;
}

const QUICK_AMOUNTS = [50, 100, 250, 500] as const;
const AUTO_PRESETS = [1.5, 2, 5, 10] as const;

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
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoAt, setAutoAt] = useState<string>('2.00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // When a new BETTING phase begins, sync the input to the running
  // stake (first round = ₹100; after win = payout; after loss = 0).
  // We also clear the feedback line so a previous round's "BUSTED"
  // error doesn't bleed into the next round.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current !== 'BETTING' && phase === 'BETTING') {
      setAmount(nextStake);
      setError(null);
      setNotice(null);
    }
    lastPhase.current = phase;
  }, [phase, nextStake]);

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
      const auto = autoEnabled && autoAt.trim() ? Number(autoAt) : null;
      if (auto !== null && (isNaN(auto) || auto < 1.01)) {
        throw new Error('auto cashout must be ≥ 1.01');
      }
      if (amount <= 0) throw new Error('amount must be ≥ 1');
      if (balance !== null && amount > balance) {
        throw new Error(`insufficient wallet (${formatRupees(balance)})`);
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

  async function topupThenBet() {
    if (balance === null) return;
    const needed = Math.max(0, amount - balance);
    const requested = Math.max(100, Math.ceil(needed / 100) * 100);
    setError(null);
    setNotice(null);
    const result = await topup(requested, {
      description: `Top up ${formatRupees(requested)} to play ${formatRupees(amount)}`,
    });
    if (result.dismissed) return;
    if (!result.ok) {
      setError(result.error ?? 'top-up failed');
      return;
    }
    setNotice(`Added ${formatRupees(result.credited)}. Placing bet…`);
    if (phase === 'BETTING' && !currentBet) await placeBet();
  }

  async function cashout() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CashoutResp>('/aviator/cashout', {});
      setCurrentBet(
        currentBet ? { ...currentBet, cashedOutAt: res.multiplier } : null,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cashedOut = currentBet?.cashedOutAt != null;
  const insufficient = balance !== null && amount > balance;
  const canBet =
    phase === 'BETTING' &&
    !currentBet &&
    !busy &&
    balance !== null &&
    amount > 0 &&
    amount <= balance;
  const canCashOut = phase === 'RUNNING' && !!currentBet && !cashedOut && !busy;
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

  // Live profit (used by the cashout button label).
  const liveProfit = currentBet ? Math.floor(currentBet.amount * liveMultiplier) : 0;

  const inputLocked = !!currentBet;
  const tier = tierFor(liveMultiplier);

  return (
    <div className="glass rounded-3xl p-4 lg:p-5 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-4 items-stretch">
        {/* Amount column ------------------------------------------- */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
              Bet amount
            </label>
            <span className="text-[10px] font-mono text-text-muted">
              {balance != null ? `wallet ${formatRupees(balance)}` : ''}
            </span>
          </div>
          <div className="flex items-stretch gap-1.5">
            <StepperBtn
              label="−"
              onClick={() => setAmount((a) => Math.max(0, a - 50))}
              disabled={inputLocked}
            />
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-text-muted text-sm">
                ₹
              </span>
              <input
                type="number"
                min={0}
                max={100000}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                disabled={inputLocked}
                className={`w-full h-12 pl-7 pr-3 bg-elevated/80 border rounded-xl font-mono text-base font-bold outline-none transition tabular-nums ${
                  insufficient
                    ? 'border-danger/60 focus:border-danger'
                    : 'border-border focus:border-aurora-violet/70'
                } disabled:opacity-60`}
              />
            </div>
            <StepperBtn
              label="+"
              onClick={() => setAmount((a) => a + 50)}
              disabled={inputLocked}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((q) => (
              <QuickChip
                key={q}
                onClick={() => setAmount((a) => a + q)}
                disabled={inputLocked}
              >
                +{q}
              </QuickChip>
            ))}
            <QuickChip
              onClick={() => setAmount((a) => Math.max(0, Math.floor(a / 2)))}
              disabled={inputLocked}
            >
              ½
            </QuickChip>
            <QuickChip
              onClick={() => setAmount((a) => a * 2)}
              disabled={inputLocked}
            >
              2×
            </QuickChip>
            <QuickChip
              onClick={() => balance != null && setAmount(balance)}
              disabled={inputLocked || balance == null}
              accent
            >
              Max
            </QuickChip>
          </div>
        </div>

        {/* Auto cashout column ------------------------------------- */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
              Auto cashout
            </label>
            <AutoToggle
              enabled={autoEnabled}
              onChange={setAutoEnabled}
              disabled={inputLocked}
            />
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="2.00"
              value={autoAt}
              onChange={(e) => setAutoAt(e.target.value)}
              disabled={inputLocked || !autoEnabled}
              className={`w-full h-12 pl-3 pr-8 bg-elevated/80 border rounded-xl font-mono text-base font-bold outline-none transition tabular-nums ${
                autoEnabled
                  ? 'border-border focus:border-success/70 text-text-primary'
                  : 'border-border text-text-muted'
              } disabled:opacity-60`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-text-muted text-sm">
              ×
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AUTO_PRESETS.map((p) => (
              <QuickChip
                key={p}
                onClick={() => {
                  setAutoEnabled(true);
                  setAutoAt(p.toFixed(2));
                }}
                disabled={inputLocked}
                active={autoEnabled && Number(autoAt) === p}
              >
                {p}×
              </QuickChip>
            ))}
          </div>
        </div>

        {/* Hero action column -------------------------------------- */}
        <div className="flex flex-col gap-2 min-w-0 lg:w-[260px]">
          <AnimatePresence mode="wait" initial={false}>
            {!currentBet || cashedOut ? (
              insufficient && phase === 'BETTING' ? (
                <ActionButton
                  key="topup"
                  onClick={topupThenBet}
                  disabled={!canTopupToBet}
                  variant="success"
                >
                  {topupBusy ? '…' : `ADD ${formatRupees(topupNeeded)} & BET`}
                </ActionButton>
              ) : (
                <ActionButton
                  key="place"
                  onClick={placeBet}
                  disabled={!canBet}
                  variant="primary"
                >
                  {phase === 'BETTING'
                    ? amount > 0
                      ? `PLACE BET · ${formatRupees(amount)}`
                      : 'PLACE BET'
                    : phase === 'RUNNING'
                    ? 'NEXT ROUND'
                    : 'WAITING…'}
                </ActionButton>
              )
            ) : phase === 'RUNNING' ? (
              <ActionButton
                key="cashout"
                onClick={cashout}
                disabled={!canCashOut}
                variant="cashout"
                tierColor={tier.color}
              >
                <div className="flex flex-col items-center leading-tight">
                  <span className="text-[10px] font-bold tracking-[0.18em] opacity-90">
                    CASHOUT
                  </span>
                  <span className="font-mono text-lg font-black">
                    {formatRupees(liveProfit)}
                  </span>
                  <span className="text-[10px] font-mono opacity-80">
                    @ {liveMultiplier.toFixed(2)}×
                  </span>
                </div>
              </ActionButton>
            ) : phase === 'CRASHED' && !cashedOut ? (
              <ActionButton key="busted" disabled variant="danger">
                BUSTED · −{formatRupees(currentBet.amount)}
              </ActionButton>
            ) : (
              <ActionButton key="locked" disabled variant="muted">
                BET LOCKED
              </ActionButton>
            )}
          </AnimatePresence>

          <FeedbackLine
            error={error}
            notice={notice}
            insufficient={insufficient && phase === 'BETTING' && !currentBet}
            topupNeeded={topupNeeded}
            cashedOut={cashedOut}
            currentBet={currentBet}
            balance={balance}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function StepperBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-11 h-12 rounded-xl bg-elevated border border-border hover:bg-elevated-hi hover:border-border-strong text-text-primary font-mono text-lg chip-press disabled:opacity-40 disabled:hover:bg-elevated disabled:hover:border-border"
    >
      {label}
    </button>
  );
}

function QuickChip({
  children,
  onClick,
  disabled,
  active,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
}) {
  const base =
    'px-2.5 py-1 rounded-lg text-xs font-bold font-mono chip-press transition border';
  let cls: string;
  if (active) {
    cls = `${base} bg-success/15 border-success/50 text-success`;
  } else if (accent) {
    cls = `${base} bg-aurora-violet/15 border-aurora-violet/40 text-aurora-violet hover:bg-aurora-violet/25`;
  } else {
    cls = `${base} bg-elevated/70 border-border text-text-secondary hover:text-text-primary hover:border-border-strong`;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${cls} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function AutoToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-50 ${
        enabled ? 'bg-success' : 'bg-elevated border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition ${
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
  tierColor,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant: 'primary' | 'success' | 'cashout' | 'danger' | 'muted';
  tierColor?: string;
}) {
  const base =
    'relative w-full h-[68px] rounded-2xl font-extrabold text-white shadow-card overflow-hidden flex items-center justify-center';
  const variants: Record<string, string> = {
    primary:
      'bg-gradient-to-br from-aurora-violet to-[#5C2BFF] hover:brightness-110',
    success:
      'bg-gradient-to-br from-success to-[#10A38A] hover:brightness-110',
    cashout: 'cashout-pulse',
    danger: 'bg-gradient-to-br from-[#7A2233] to-[#3D1019] opacity-95',
    muted: 'bg-elevated opacity-70',
  };
  return (
    <motion.button
      key={variant}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 340, damping: 26 }}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
      style={
        variant === 'cashout' && tierColor
          ? {
              backgroundImage: `linear-gradient(135deg, ${tierColor}, ${shade(tierColor, -25)})`,
            }
          : undefined
      }
    >
      {/* glass sheen on top */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/15 to-transparent"
      />
      <span className="relative">{children}</span>
    </motion.button>
  );
}

function FeedbackLine({
  error,
  notice,
  insufficient,
  topupNeeded,
  cashedOut,
  currentBet,
  balance,
}: {
  error: string | null;
  notice: string | null;
  insufficient: boolean;
  topupNeeded: number;
  cashedOut: boolean;
  currentBet: { amount: number; cashedOutAt: number | null } | null;
  balance: number | null;
}) {
  if (error) return <p className="text-xs text-danger leading-tight">{error}</p>;
  if (notice) return <p className="text-xs text-success leading-tight">{notice}</p>;
  if (cashedOut && currentBet?.cashedOutAt != null) {
    const profit = Math.floor(currentBet.amount * currentBet.cashedOutAt);
    return (
      <p className="text-xs text-success leading-tight">
        Cashed out @ {currentBet.cashedOutAt.toFixed(2)}× · +{formatRupees(profit)}
      </p>
    );
  }
  if (insufficient) {
    return (
      <p className="text-xs text-danger leading-tight">
        Wallet {formatRupees(balance)}. Tap to add {formatRupees(topupNeeded)}.
      </p>
    );
  }
  return null;
}

/**
 * Lighten/darken a hex colour by a percentage. Tiny inline helper —
 * used to derive the cashout button's diagonal gradient from the live
 * tier colour without rebuilding the colour ramp.
 */
function shade(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const m = (1 + percent / 100);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * m)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}
