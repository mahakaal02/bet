'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';
import { tierFor } from '@/lib/tiers';
import { formatCoins } from '@/lib/format';

/**
 * Bet controls — the player's primary action surface. Five logical
 * button states:
 *
 *   BETTING + no bet + has coins        →  PLACE BET · X coins  (violet)
 *   BETTING + no bet + insufficient     →  TOP UP TO BET         (mint, navigates)
 *   RUNNING + live bet                  →  CASHOUT X coins @ M×  (tier-tinted, pulsing)
 *   CRASHED + lost bet                  →  BUSTED − X coins       (red, locked)
 *   any + cashed out / ride out          →  WAITING / NEXT ROUND  (muted)
 *
 * Behaviour invariants:
 *   - Min bet is 100 coins (matches the platform-wide minimum;
 *     amounts below 100 are rejected client-side with a clear
 *     message — no submit). After a loss, the input auto-resets
 *     to 100, not 0, so a tap-only player can rebet immediately.
 *   - When the wallet can't cover the requested stake, the hero
 *     button no longer tries to open Razorpay inline; it routes
 *     the user to the Exchange wallet top-up page (`:3100/wallet`)
 *     with the bearer token attached for SSO. The page is now the
 *     single canonical surface for adding coins.
 *   - The button is always rendered (no AnimatePresence mode="wait"
 *     gap where the variant key was changing). Disabled states are
 *     visual only — the click handler still resolves cleanly.
 */

const MIN_BET = 100;
const QUICK_AMOUNTS = [50, 100, 250, 500] as const;
const AUTO_PRESETS = [1.5, 2, 5, 10] as const;

interface PlaceBidResp {
  betId: string;
  amount: number;
  autoCashoutAt: number | null;
}

interface CashoutResp {
  multiplier: number;
  payout: number;
}

/** Browser/emulator-aware exchange origin. Mirrors `lib/api.ts` */
function exchangeOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EXCHANGE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:3100`;
    }
  }
  return 'http://localhost:3100';
}

function openTopupPage() {
  const token = getToken();
  const base = `${exchangeOrigin()}/wallet`;
  window.location.href = token
    ? `${base}?token=${encodeURIComponent(token)}`
    : base;
}

export default function BetControls() {
  const phase = useGame((s) => s.phase);
  const balance = useGame((s) => s.balance);
  const currentBet = useGame((s) => s.currentBet);
  const setCurrentBet = useGame((s) => s.setCurrentBet);
  const setBalance = useGame((s) => s.setBalance);
  const liveMultiplier = useGame((s) => s.multiplier);
  const nextStake = useGame((s) => s.nextStake);

  const [amount, setAmount] = useState<number>(Math.max(MIN_BET, nextStake));
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoAt, setAutoAt] = useState<string>('2.00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous guard against double-tap. React state updates are
  // async — two rapid taps can both pass the `if (busy) return`
  // check in the same render frame because the closure still sees
  // the old value. A ref flips synchronously, so the second tap is
  // a no-op even if the React re-render hasn't happened yet.
  const inFlightRef = useRef(false);

  // When a new BETTING phase begins, sync the input to the running
  // stake (clamped to MIN_BET). Also clear any leftover BUSTED error
  // from the previous round so the panel reads "fresh" each cycle.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current !== 'BETTING' && phase === 'BETTING') {
      setAmount(Math.max(MIN_BET, nextStake));
      setError(null);
    }
    lastPhase.current = phase;
  }, [phase, nextStake]);

  useEffect(() => {
    if (phase === 'BETTING' && !currentBet) {
      setAmount(Math.max(MIN_BET, nextStake));
    }
  }, [nextStake]); // eslint-disable-line react-hooks/exhaustive-deps

  async function placeBet() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const auto = autoEnabled && autoAt.trim() ? Number(autoAt) : null;
      if (auto !== null && (isNaN(auto) || auto < 1.01)) {
        throw new Error('Auto cashout must be at least 1.01×');
      }
      if (amount < MIN_BET) {
        throw new Error(`Minimum bet is ${MIN_BET} coins`);
      }
      if (balance != null && amount > balance) {
        // Server-side guard duplicates the same rule — this is the
        // friendlier client-side preflight.
        throw new Error(`Wallet has only ${formatCoins(balance)}`);
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
      if (balance != null) setBalance(balance - res.amount);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      // The optimistic balance decrement only runs on success, so
      // there's nothing to roll back here. But if a race ever puts
      // the client + server out of sync, re-fetch the authoritative
      // balance — cheap REST hit, kills any drift.
      void api
        .get<{ balance: number }>('/wallet/balance')
        .then((b) => setBalance(b.balance))
        .catch(() => {});
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  }

  async function cashout() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
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
      inFlightRef.current = false;
    }
  }

  const cashedOut = currentBet?.cashedOutAt != null;
  const insufficient = balance != null && amount > balance;
  const belowMin = amount < MIN_BET;

  // Hero button is *always* rendered, never gated behind AnimatePresence's
  // mode="wait" (which used to leave a no-button gap during variant
  // transitions and made clicks feel "swallowed"). Disabled / busy
  // states are pure presentation; the click handler resolves cleanly.
  //
  // State matrix (with explicit labels for the formerly-ambiguous
  // "WAITING…" branches):
  //
  //   currentBet | cashedOut | phase     → state    → label
  //   -----------|-----------|-----------|----------|-----------------
  //   null       | -         | BETTING   → place    | PLACE BET
  //   null       | -         | BETTING   → topup    | TOP UP TO BET (when insufficient balance)
  //   null       | -         | RUNNING   → between  | WAIT FOR NEXT ROUND
  //   null       | -         | CRASHED   → between  | WAIT FOR NEXT ROUND
  //   set        | false     | BETTING   → placed   | BET PLACED · <coins>     ← was "WAITING…", users complained
  //   set        | false     | RUNNING   → cashout  | CASHOUT (live)
  //   set        | false     | CRASHED   → busted   | BUSTED · −<coins>
  //   set        | true      | BETTING   → between  | WAIT FOR NEXT ROUND   (cashed out, round resetting)
  //   set        | true      | RUNNING   → waiting  | CASHED OUT — WAITING
  //   set        | true      | CRASHED   → waiting  | CASHED OUT — WAITING
  // PR-AVIATOR-PAYOUT-CAP — surfaced via PLAYER_CASHOUT.capped which
  // useAviator.ts patches onto `currentBet` for "this is me". The
  // 'capped' state SUPERSEDES the normal 'waiting' state because the
  // semantic intent is different ("you won the max, the cap fired"
  // vs the generic "wait, your cashout already happened").
  const cappedByPayoutCap = currentBet?.cappedByPayoutCap === true;

  const heroState: HeroState = (() => {
    // Branch 1: no live bet (either never placed, or already cashed
    // out so the bet ended successfully).
    if (!currentBet || cashedOut) {
      if (phase === 'BETTING') {
        if (insufficient || (balance != null && balance < MIN_BET)) return 'topup';
        return 'place';
      }
      // PR-AVIATOR-PAYOUT-CAP — cap-triggered settlement gets its own
      // chip so the player knows they got the maximum payout the cap
      // allows. Distinct from generic "CASHED OUT — WAITING".
      if (cappedByPayoutCap && (phase === 'RUNNING' || phase === 'CRASHED')) {
        return 'capped';
      }
      // Cashed-out users get the existing "CASHED OUT — WAITING"
      // chip during RUNNING / CRASHED — different intent from
      // someone who just hasn't bet yet.
      if (cashedOut && (phase === 'RUNNING' || phase === 'CRASHED')) {
        return 'waiting';
      }
      // No bet, watching the round play out. Distinct from "WAITING…"
      // because there's nothing for the user to act on; they're just
      // waiting for the next BETTING window.
      return 'between';
    }
    // Branch 2: live bet present, not yet cashed out.
    if (phase === 'RUNNING') return 'cashout';
    if (phase === 'CRASHED') return 'busted';
    // BETTING phase with a placed bet — the round hasn't started yet
    // but the user's stake is locked in. Was rendered as the
    // ambiguous "WAITING…" before; now an explicit confirmation.
    if (phase === 'BETTING') return 'placed';
    // UNKNOWN phase (pre-socket-connect) with a bet shouldn't happen
    // in practice, but be safe — render the same neutral chip.
    return 'between';
  })();

  const inputLocked = !!currentBet && !cashedOut;
  const tier = tierFor(liveMultiplier);
  const liveProfit = currentBet ? Math.floor(currentBet.amount * liveMultiplier) : 0;

  function onHeroClick() {
    if (heroState === 'place') return void placeBet();
    if (heroState === 'cashout') return void cashout();
    if (heroState === 'topup') return openTopupPage();
    // busted / waiting / placed / between → noop. The button is
    // still mounted (visible as locked) so the layout doesn't
    // shift, but it doesn't react.
  }

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
              {balance != null ? `wallet ${formatCoins(balance)}` : ''}
            </span>
          </div>
          <div className="flex items-stretch gap-1.5">
            <StepperBtn
              label="−"
              onClick={() =>
                setAmount((a) => Math.max(MIN_BET, a - 50))
              }
              disabled={inputLocked || amount <= MIN_BET}
            />
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                max={100000}
                value={amount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAmount(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                onBlur={() => {
                  // Coerce below-min entries up to the floor on blur, so
                  // the user doesn't get stuck submitting a too-small
                  // value and seeing only the inline error.
                  if (amount > 0 && amount < MIN_BET) setAmount(MIN_BET);
                }}
                disabled={inputLocked}
                aria-label="Bet amount in coins"
                className={`w-full h-12 pl-3 pr-16 bg-elevated/80 border rounded-xl font-mono text-base font-bold outline-none transition tabular-nums ${
                  insufficient || belowMin
                    ? 'border-danger/60 focus:border-danger'
                    : 'border-border focus:border-aurora-violet/70'
                } disabled:opacity-60`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-text-muted text-xs pointer-events-none">
                coins
              </span>
            </div>
            <StepperBtn
              label="+"
              onClick={() => setAmount((a) => Math.max(MIN_BET, a) + 50)}
              disabled={inputLocked}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((q) => (
              <QuickChip
                key={q}
                onClick={() =>
                  setAmount((a) => Math.max(MIN_BET, a + q))
                }
                disabled={inputLocked}
              >
                +{q}
              </QuickChip>
            ))}
            <QuickChip
              onClick={() =>
                setAmount((a) => Math.max(MIN_BET, Math.floor(a / 2)))
              }
              disabled={inputLocked}
            >
              ½
            </QuickChip>
            <QuickChip
              onClick={() => setAmount((a) => Math.max(MIN_BET, a) * 2)}
              disabled={inputLocked}
            >
              2×
            </QuickChip>
            <QuickChip
              onClick={() =>
                balance != null && setAmount(Math.max(MIN_BET, balance))
              }
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
              aria-label="Auto cashout multiplier"
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
          <HeroButton
            state={heroState}
            onClick={onHeroClick}
            busy={busy}
            amount={amount}
            liveProfit={liveProfit}
            liveMultiplier={liveMultiplier}
            tierColor={tier.color}
            currentBetAmount={currentBet?.amount ?? 0}
            cashedOut={cashedOut}
            // PR-AVIATOR-PAYOUT-CAP — values for the 'capped' chip.
            // cashedOutAt holds the multiplier at the time the cap
            // fired; originalPayout (optional) lets us render the
            // "could have won" line.
            cappedPayout={
              currentBet?.cappedByPayoutCap
                ? Math.floor(
                    currentBet.amount *
                      (currentBet.cashedOutAt ?? 1),
                  )
                : null
            }
            cappedOriginalPayout={currentBet?.originalPayout ?? null}
            cappedMultiplier={
              currentBet?.cappedByPayoutCap
                ? currentBet.cashedOutAt ?? null
                : null
            }
          />

          <FeedbackLine
            error={error}
            insufficient={insufficient && phase === 'BETTING' && !currentBet}
            belowMin={belowMin && phase === 'BETTING' && !currentBet}
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

/**
 * `placed`  — user just placed a bet during the BETTING window; the
 *             round hasn't started yet. Replaces the formerly
 *             ambiguous "WAITING…" message users complained about.
 * `between` — no live bet, round is RUNNING or CRASHED; the user
 *             is simply waiting for the next BETTING window.
 * `waiting` — user already cashed out, the round is finishing.
 *             Kept distinct so the chip can say "CASHED OUT —
 *             WAITING" instead of the generic "wait for next round".
 */
type HeroState =
  | 'place'
  | 'topup'
  | 'cashout'
  | 'busted'
  | 'placed'
  | 'between'
  | 'waiting'
  /**
   * `capped` — server's payout cap auto-cashed the bet at the cap
   * line. UI shows "MAX PAYOUT REACHED" plus the actual payout +
   * (optionally) the "could have won" figure. Distinct from
   * `waiting` because the intent is "you won the maximum", not the
   * neutral "your cashout is in flight".
   */
  | 'capped';

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

/**
 * Always-mounted hero button. The previous version was wrapped in
 * an `AnimatePresence mode="wait"` that swapped child components
 * keyed on state — during the wait between exit + entrance, the
 * button briefly didn't exist in the DOM, which let some user
 * clicks fall through and made the panel feel unresponsive.
 *
 * This version keeps the button mounted and just animates the
 * label change with a fade. State is communicated via colour +
 * label, with an explicit `aria-disabled` only when the action
 * is genuinely a no-op (busted / waiting / mid-flight).
 */
function HeroButton({
  state,
  onClick,
  busy,
  amount,
  liveProfit,
  liveMultiplier,
  tierColor,
  currentBetAmount,
  cashedOut,
  cappedPayout,
  cappedOriginalPayout,
  cappedMultiplier,
}: {
  state: HeroState;
  onClick: () => void;
  busy: boolean;
  amount: number;
  liveProfit: number;
  liveMultiplier: number;
  tierColor: string;
  currentBetAmount: number;
  cashedOut: boolean;
  // PR-AVIATOR-PAYOUT-CAP — pre-computed values for the 'capped' chip.
  // All three may be null when the cap didn't fire (e.g. when this
  // button is rendered in any other state, or for old servers that
  // don't send the cap flag).
  cappedPayout: number | null;
  cappedOriginalPayout: number | null;
  cappedMultiplier: number | null;
}) {
  const base =
    'relative w-full h-[68px] rounded-2xl font-extrabold text-white shadow-card overflow-hidden flex items-center justify-center transition select-none';

  let visualStyle = '';
  let inlineStyle: React.CSSProperties | undefined;
  let label: React.ReactNode;
  let actionable = !busy;

  switch (state) {
    case 'place':
      visualStyle = 'bg-gradient-to-br from-aurora-violet to-[#5C2BFF] hover:brightness-110 active:brightness-95';
      label = busy ? (
        '…'
      ) : amount > 0 ? (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] tracking-[0.18em] opacity-85">PLACE BET</span>
          <span className="font-mono text-lg font-black">{formatCoins(amount)}</span>
        </span>
      ) : (
        'PLACE BET'
      );
      break;
    case 'topup':
      visualStyle = 'bg-gradient-to-br from-success to-[#10A38A] hover:brightness-110 active:brightness-95';
      label = (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] tracking-[0.18em] opacity-90">TOP UP TO BET</span>
          <span className="font-mono text-sm font-black">Add coins</span>
        </span>
      );
      break;
    case 'cashout':
      visualStyle = 'cashout-pulse';
      inlineStyle = {
        backgroundImage: `linear-gradient(135deg, ${tierColor}, ${shade(tierColor, -25)})`,
      };
      label = (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] font-bold tracking-[0.18em] opacity-90">CASHOUT</span>
          <span className="font-mono text-lg font-black tabular-nums">
            {formatCoins(liveProfit)}
          </span>
          <span className="text-[10px] font-mono opacity-80 tabular-nums">
            @ {liveMultiplier.toFixed(2)}×
          </span>
        </span>
      );
      break;
    case 'busted':
      visualStyle = 'bg-gradient-to-br from-[#7A2233] to-[#3D1019] opacity-95';
      label = `BUSTED · −${formatCoins(currentBetAmount)}`;
      actionable = false;
      break;
    case 'placed':
      // Confirmation chip: the user just placed a bet during the
      // BETTING window. Keep the tone positive (success-tinted)
      // so it reads as "you're in" rather than "something's
      // stuck". Coin amount echoed so the user sees the stake
      // they committed.
      visualStyle = 'bg-success/15 border border-success/40 text-success';
      label = (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] tracking-[0.18em] opacity-90">BET PLACED</span>
          <span className="font-mono text-lg font-black tabular-nums">
            {formatCoins(currentBetAmount)} coins
          </span>
        </span>
      );
      actionable = false;
      break;
    case 'between':
      // No bet, round is mid-flight or just ended. Tells the user
      // exactly what they're waiting for — the next BETTING phase.
      visualStyle = 'bg-elevated/80 text-text-secondary';
      label = (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] tracking-[0.18em] opacity-85">
            WAIT FOR NEXT ROUND
          </span>
          <span className="text-[10px] opacity-60">
            Betting opens in a few seconds
          </span>
        </span>
      );
      actionable = false;
      break;
    case 'capped':
      // PR-AVIATOR-PAYOUT-CAP — the server's cap auto-cashed this
      // bet at the cap line. Visual: warm amber tone (positive but
      // distinct from the live-cashout green), explicit primary
      // label so there's no ambiguity, two sub-lines showing the
      // actual capped payout + the multiplier the cap fired at.
      // Plane continues flying for everyone else — the chip
      // communicates "you're settled" without implying the round
      // is over.
      visualStyle =
        'bg-gradient-to-br from-warning/30 to-warning/15 border border-warning/50 text-warning';
      label = (
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] font-bold tracking-[0.18em] opacity-90">
            MAX PAYOUT REACHED
          </span>
          <span className="font-mono text-lg font-black tabular-nums">
            {cappedPayout != null
              ? `+${formatCoins(cappedPayout)} coins`
              : 'Auto cashed out'}
          </span>
          <span className="text-[10px] font-mono opacity-80 tabular-nums">
            {cappedMultiplier != null
              ? `Auto cashed out @ ${cappedMultiplier.toFixed(2)}×`
              : 'Auto cashed out'}
          </span>
        </span>
      );
      actionable = false;
      break;
    case 'waiting':
    default:
      visualStyle = 'bg-elevated/80 text-text-secondary';
      // Reached only when the user cashed out and the round is
      // still resolving — "WAITING…" is fine here because the
      // intent (we already won; just letting the round play
      // out) is unambiguous.
      label = cashedOut ? 'CASHED OUT — WAITING' : 'WAITING…';
      actionable = false;
      break;
  }

  // Suppress unused-var warning if `cappedOriginalPayout` not
  // referenced above — kept in the prop list for future "could
  // have won X" expansion without re-plumbing the parent.
  void cappedOriginalPayout;

  return (
    <button
      type="button"
      onClick={actionable ? onClick : undefined}
      aria-disabled={!actionable}
      data-state={state}
      className={`${base} ${visualStyle} ${actionable ? 'cursor-pointer' : 'cursor-not-allowed opacity-90'}`}
      style={inlineStyle}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/15 to-transparent pointer-events-none"
      />
      <span className="relative">{label}</span>
    </button>
  );
}

function FeedbackLine({
  error,
  insufficient,
  belowMin,
  cashedOut,
  currentBet,
  balance,
}: {
  error: string | null;
  insufficient: boolean;
  belowMin: boolean;
  cashedOut: boolean;
  currentBet: { amount: number; cashedOutAt: number | null } | null;
  balance: number | null;
}) {
  if (error) return <p className="text-xs text-danger leading-tight">{error}</p>;
  if (cashedOut && currentBet?.cashedOutAt != null) {
    const profit = Math.floor(currentBet.amount * currentBet.cashedOutAt);
    return (
      <p className="text-xs text-success leading-tight">
        Cashed out @ {currentBet.cashedOutAt.toFixed(2)}× · +{formatCoins(profit)}
      </p>
    );
  }
  if (insufficient) {
    return (
      <p className="text-xs text-danger leading-tight">
        Wallet has {formatCoins(balance)} — top up to place this bet.
      </p>
    );
  }
  if (belowMin) {
    return (
      <p className="text-xs text-warning leading-tight">
        Minimum bet is {MIN_BET} coins.
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
