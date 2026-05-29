'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useGame } from '@/lib/store';
import { getToken } from '@/lib/auth';
import { tierFor } from '@/lib/tiers';
import { formatCoins } from '@/lib/format';
import { useTranslation, type TranslateFunction } from '@/lib/i18n/client';

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
 *
 * Layout (PR-AVIATOR-COMPACT-BET-CONTROLS):
 *   - Single bet panel (not a dual side-by-side like Spribe ships).
 *     We have one bet per round; rendering a second always-disabled
 *     slot just to mirror the reference design wastes space.
 *   - Bet | Auto tab toggle at the top. Tapping "Auto" reveals the
 *     auto-cashout multiplier input + preset chips below the amount
 *     section. Tapping "Bet" collapses it back. Cleaner than the
 *     prior layout where the auto-cashout column sat next to the
 *     stake column eating ~33% of horizontal width even when unused.
 *   - Amount stepper (− [input] +) and quick chips on the LEFT,
 *     big BET hero button on the RIGHT (≈half width on tablet+).
 *     On phone the hero stacks below — single-column layout works
 *     better at narrow widths because the BET button needs full
 *     reach for the player's thumb.
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

type Mode = 'bet' | 'auto';

export default function BetControls() {
  const { t } = useTranslation();
  const phase = useGame((s) => s.phase);
  const balance = useGame((s) => s.balance);
  const currentBet = useGame((s) => s.currentBet);
  const setCurrentBet = useGame((s) => s.setCurrentBet);
  const setBalance = useGame((s) => s.setBalance);
  const liveMultiplier = useGame((s) => s.multiplier);
  const nextStake = useGame((s) => s.nextStake);

  const [amount, setAmount] = useState<number>(Math.max(MIN_BET, nextStake));
  const [mode, setMode] = useState<Mode>('bet');
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
      // Mode-aware auto-cashout: the "Auto" tab carries an explicit
      // multiplier; "Bet" tab sends null and the server lets the
      // round ride until the user taps cashout manually.
      const auto = mode === 'auto' && autoAt.trim() ? Number(autoAt) : null;
      if (auto !== null && (isNaN(auto) || auto < 1.01)) {
        throw new Error(t('game.autoCashoutMinError'));
      }
      if (amount < MIN_BET) {
        throw new Error(t('game.minBetCoins', { min: MIN_BET }));
      }
      if (balance != null && amount > balance) {
        // Server-side guard duplicates the same rule — this is the
        // friendlier client-side preflight.
        throw new Error(t('game.walletHasOnly', { amount: formatCoins(balance) }));
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
    <div className="glass rounded-3xl p-3 lg:p-4 space-y-3">
      {/* Mode tabs — Bet (manual) vs Auto (with cashout multiplier).
          Live-bet state forces the tabs into read-only; switching mid-
          round would imply mutating the bet's autoCashoutAt server-side
          (we don't support that yet). The chosen tab still reads
          truthfully even when locked. */}
      <ModeTabs
        mode={mode}
        onChange={setMode}
        disabled={inputLocked}
        t={t}
      />

      {/* Main row: controls on the LEFT, hero BET button on the RIGHT.
          Single column on phone (BET stacks below) — the button needs
          full thumb-reach width when the panel is narrow. Tablet+
          splits 1fr | 1fr so neither side dominates. */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3 items-stretch">
        {/* LEFT: amount stepper + quick chips (+ auto inputs when Auto tab) */}
        <div className="space-y-2.5">
          {/* Amount stepper — − [input] + arrangement. The stepper
              buttons hug the input on either side so the whole row
              reads as one control. */}
          <div className="flex items-stretch gap-1.5">
            <StepperBtn
              label="−"
              onClick={() =>
                setAmount((a) => Math.max(MIN_BET, a - 50))
              }
              disabled={inputLocked || amount <= MIN_BET}
            />
            <div className="relative flex-1 min-w-0">
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
                aria-label={t('game.betAmount')}
                className={`w-full h-11 pl-3 pr-14 bg-elevated/80 border rounded-xl font-mono text-base font-bold outline-none transition tabular-nums text-center ${
                  insufficient || belowMin
                    ? 'border-danger/60 focus:border-danger'
                    : 'border-border focus:border-aurora-violet/70'
                } disabled:opacity-60`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-text-muted text-[10px] pointer-events-none uppercase tracking-wider">
                {t('common.coins')}
              </span>
            </div>
            <StepperBtn
              label="+"
              onClick={() => setAmount((a) => Math.max(MIN_BET, a) + 50)}
              disabled={inputLocked}
            />
          </div>

          {/* Quick stake chips. 4-wide grid keeps them tight and
              predictable — flex-wrap could shift between 3 and 4 per
              row depending on width and feels jumpy. 7 chips → 2 rows
              of 4 (last cell renders the "Max" accent chip and trails
              by itself on the second row, which is fine and matches
              the reference's visual weight). */}
          <div className="grid grid-cols-4 gap-1.5">
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
              {t('game.maxChip')}
            </QuickChip>
          </div>

          {/* Auto cashout section — only renders when the Auto tab is
              active. Collapsible to keep the panel compact when the
              user is on the default Bet tab. The visual treatment
              (dashed divider + smaller header) signals "this is a
              sub-option of the chosen mode" without needing a
              separate card. */}
          {mode === 'auto' && (
            <div className="pt-1.5 mt-1 border-t border-dashed border-divider space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  {t('game.autoCashoutAt')}
                </label>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="2.00"
                  value={autoAt}
                  onChange={(e) => setAutoAt(e.target.value)}
                  disabled={inputLocked}
                  aria-label={t('game.autoCashoutAria')}
                  className="w-full h-10 pl-3 pr-7 bg-elevated/80 border border-border focus:border-success/70 rounded-xl font-mono text-sm font-bold outline-none transition tabular-nums text-center disabled:opacity-60"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-text-muted text-sm">
                  ×
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {AUTO_PRESETS.map((p) => (
                  <QuickChip
                    key={p}
                    onClick={() => setAutoAt(p.toFixed(2))}
                    disabled={inputLocked}
                    active={Number(autoAt) === p}
                  >
                    {p}×
                  </QuickChip>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: hero BET button. Fills the right half on tablet+;
            stacks below on phone (sm: breakpoint shifts to side-by-
            side). Fixed minimum height keeps the button visually
            "big" regardless of how much auto-cashout content
            renders on the left. */}
        <div className="flex flex-col gap-2 min-w-0">
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
            t={t}
            // PR-AVIATOR-PAYOUT-CAP — values for the 'capped' chip.
            // cashedOutAt holds the multiplier at the time the cap fired.
            cappedPayout={
              currentBet?.cappedByPayoutCap
                ? Math.floor(
                    currentBet.amount *
                      (currentBet.cashedOutAt ?? 1),
                  )
                : null
            }
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
            t={t}
          />
        </div>
      </div>

      {/* Wallet readout — moved out of the per-column header so it
          gets a dedicated line at the bottom of the panel. Less
          cluttered than packing it next to "Bet amount" and gives
          the balance figure proper prominence. */}
      {balance != null && (
        <div className="flex items-center justify-between text-[10px] font-mono text-text-muted px-1">
          <span>
            {t('game.wallet')}{' '}
            <span className="text-text-secondary font-bold tabular-nums">
              {formatCoins(balance)}
            </span>
          </span>
          <span className="uppercase tracking-[0.18em]">
            {t('game.minBet', { min: MIN_BET })}
          </span>
        </div>
      )}
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

/**
 * Mode tabs — Bet / Auto pill. Two segmented buttons inside a single
 * elevated pill; the active button picks up the success accent so
 * the choice reads at a glance. Disabled when a bet is in flight
 * (mode change would imply mutating the placed bet's autoCashoutAt,
 * which the server doesn't support yet).
 */
function ModeTabs({
  mode,
  onChange,
  disabled,
  t,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
  t: TranslateFunction;
}) {
  const tab = (key: Mode, label: string) => {
    const active = mode === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => !disabled && onChange(key)}
        disabled={disabled}
        aria-pressed={active}
        className={`flex-1 h-8 rounded-full text-xs font-bold uppercase tracking-[0.16em] transition ${
          active
            ? 'bg-success/15 text-success border border-success/40'
            : 'text-text-muted hover:text-text-secondary'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex p-1 rounded-full bg-elevated/70 border border-border w-fit">
      {tab('bet', t('game.bet'))}
      {tab('auto', t('game.auto'))}
    </div>
  );
}

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
      className="w-10 h-11 rounded-xl bg-elevated border border-border hover:bg-elevated-hi hover:border-border-strong text-text-primary font-mono text-lg chip-press disabled:opacity-40 disabled:hover:bg-elevated disabled:hover:border-border shrink-0"
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
    'h-8 rounded-lg text-xs font-bold font-mono chip-press transition border flex items-center justify-center';
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
 *
 * Sizing note: `min-h-[112px]` keeps the hero visually "big"
 * regardless of how much content the left column renders (the
 * left grows when the Auto tab is open). On phone the button
 * still fills the full width once it stacks below.
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
  cappedMultiplier,
  t,
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
  // Both may be null when the cap didn't fire (e.g. when this button
  // is rendered in any other state, or for old servers that don't send
  // the cap flag).
  cappedPayout: number | null;
  cappedMultiplier: number | null;
  t: TranslateFunction;
}) {
  const base =
    'relative w-full flex-1 min-h-[112px] rounded-2xl font-extrabold text-white shadow-card overflow-hidden flex items-center justify-center transition select-none';

  let visualStyle = '';
  let inlineStyle: React.CSSProperties | undefined;
  let label: React.ReactNode;
  let actionable = !busy;

  switch (state) {
    case 'place':
      // The reference's BET button is a vivid green — mapping to our
      // `success` token keeps it on-system without forking the colour
      // ramp. Was violet/blue before; the green reads more clearly as
      // "this is the primary action".
      visualStyle = 'bg-gradient-to-br from-success to-[#10A38A] hover:brightness-110 active:brightness-95';
      label = busy ? (
        '…'
      ) : amount > 0 ? (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] font-bold opacity-95">{t('game.placeBet')}</span>
          <span className="font-mono text-2xl font-black tabular-nums">{formatCoins(amount)}</span>
          <span className="text-[10px] tracking-[0.16em] opacity-75">{t('common.coins')}</span>
        </span>
      ) : (
        t('game.placeBet')
      );
      break;
    case 'topup':
      visualStyle = 'bg-gradient-to-br from-warning to-[#D96A2A] hover:brightness-110 active:brightness-95';
      label = (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] font-bold opacity-95">{t('game.topUpToBet')}</span>
          <span className="font-mono text-base font-black">{t('game.topUpToBetSub')}</span>
        </span>
      );
      break;
    case 'cashout':
      visualStyle = 'cashout-pulse';
      inlineStyle = {
        backgroundImage: `linear-gradient(135deg, ${tierColor}, ${shade(tierColor, -25)})`,
      };
      label = (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs font-bold tracking-[0.22em] opacity-95">{t('game.cashout')}</span>
          <span className="font-mono text-2xl font-black tabular-nums">
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
      label = (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] opacity-95">{t('game.busted')}</span>
          <span className="font-mono text-xl font-black tabular-nums">
            −{formatCoins(currentBetAmount)}
          </span>
        </span>
      );
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
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] font-bold opacity-95">{t('game.betPlaced')}</span>
          <span className="font-mono text-xl font-black tabular-nums">
            {formatCoins(currentBetAmount)}
          </span>
          <span className="text-[10px] tracking-[0.16em] opacity-70">{t('game.waitingForRound')}</span>
        </span>
      );
      actionable = false;
      break;
    case 'between':
      // No bet, round is mid-flight or just ended. Tells the user
      // exactly what they're waiting for — the next BETTING phase.
      visualStyle = 'bg-elevated/80 text-text-secondary border border-border';
      label = (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] opacity-90">
            {t('game.waitForNextRound')}
          </span>
          <span className="text-[10px] opacity-60">
            {t('game.bettingOpensSoon')}
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
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs font-bold tracking-[0.22em] opacity-95">
            {t('game.maxPayoutReached')}
          </span>
          <span className="font-mono text-xl font-black tabular-nums">
            {cappedPayout != null
              ? `+${formatCoins(cappedPayout)}`
              : t('game.autoCashedOut')}
          </span>
          <span className="text-[10px] font-mono opacity-80 tabular-nums">
            {cappedMultiplier != null
              ? `@ ${cappedMultiplier.toFixed(2)}×`
              : t('game.autoCashedOut')}
          </span>
        </span>
      );
      actionable = false;
      break;
    case 'waiting':
    default:
      visualStyle = 'bg-elevated/80 text-text-secondary border border-border';
      // Reached only when the user cashed out and the round is
      // still resolving — "WAITING…" is fine here because the
      // intent (we already won; just letting the round play
      // out) is unambiguous.
      label = cashedOut ? (
        <span className="flex flex-col items-center leading-tight gap-1">
          <span className="text-xs tracking-[0.22em] opacity-90">{t('game.cashedOut')}</span>
          <span className="text-[10px] opacity-70">{t('game.waitingForFinish')}</span>
        </span>
      ) : (
        t('game.waiting')
      );
      actionable = false;
      break;
  }

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
  t,
}: {
  error: string | null;
  insufficient: boolean;
  belowMin: boolean;
  cashedOut: boolean;
  currentBet: { amount: number; cashedOutAt: number | null } | null;
  balance: number | null;
  t: TranslateFunction;
}) {
  if (error) return <p className="text-xs text-danger leading-tight">{error}</p>;
  if (cashedOut && currentBet?.cashedOutAt != null) {
    const profit = Math.floor(currentBet.amount * currentBet.cashedOutAt);
    return (
      <p className="text-xs text-success leading-tight">
        {t('game.cashedOutAt', {
          multiplier: currentBet.cashedOutAt.toFixed(2),
          coins: formatCoins(profit),
        })}
      </p>
    );
  }
  if (insufficient) {
    return (
      <p className="text-xs text-danger leading-tight">
        {t('game.walletHasTopUp', { amount: formatCoins(balance) })}
      </p>
    );
  }
  if (belowMin) {
    return (
      <p className="text-xs text-warning leading-tight">
        {t('game.minBetCoins', { min: MIN_BET })}
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
