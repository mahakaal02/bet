import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface AviatorSettings {
  maxPayout: string | null;
  forcedNextPayout: string | null;
  updatedAt: string;
}

interface PayoutCapConfig {
  enabled: boolean;
  maxCoins: number;
}

/**
 * PR-AVIATOR-PAYOUT-CAP — verbatim warning text from the product
 * spec. Shown in a `window.confirm` when the admin disables the
 * cap; explicit OK/Cancel ensures the action isn't a one-misclick
 * away.
 */
const DISABLE_CAP_WARNING =
  'Disabling payout cap can expose the platform to extreme financial ' +
  'risk from unusually high multiplier rounds and coordinated betting ' +
  'behavior. Proceed only if you fully understand the implications.';

const DEFAULT_CAP_COINS = 20_000;

type EngineKind = 'legacy' | 'heavytail';
type CrashMode = 'balanced' | 'fast_loss' | 'streamer';

interface BucketProbability {
  label: string;
  probability: number;
}

interface CrashEngineSnapshot {
  engineEnabled: boolean;
  adaptiveEnabled: boolean;
  baseMode: 'BALANCED' | 'FAST_LOSS' | 'STREAMER';
  activeMode: 'BALANCED' | 'FAST_LOSS' | 'STREAMER';
  exposureFactor: number;
  targetRtp: number;
  analyticRtpAtRef: number;
  rtpBands: {
    configured: number;
    atRef: number;
    atLow: number;
    atHigh: number;
    pInsta: number;
  };
  params: {
    rtp: number;
    bias: number;
    biasUpper: number;
    k: number;
    cRef: number;
    maxMultiplier: number;
  };
  exposure: {
    smoothedStake: number;
    smoothedPayout: number;
    smoothedBettors: number;
    rollingRtp: number;
    roundsObserved: number;
  };
  buckets: BucketProbability[];
}

/**
 * Admin knobs for Aviator. Two concerns:
 *
 *   1. Max payout — a global ceiling applied after the provably-fair RNG
 *      computes a round's crash multiplier. Doesn't affect odds; it just
 *      clips the visible result. Default blank = uncapped.
 *
 *   2. Force next payout — a one-shot override under "Advanced". Setting a
 *      value pins the very next round's crash multiplier to exactly that
 *      number; the backend consumes (reads + clears) it atomically so it
 *      fires exactly once, after which the auction proceeds normally.
 *
 * The Advanced section is collapsed by default because forcing a payout is
 * an outcome-altering action — admins shouldn't be one missed click away
 * from rigging a round.
 */
export default function AviatorControls() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [maxPayout, setMaxPayout] = useState('');
  const [forced, setForced] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const [savingMax, setSavingMax] = useState(false);
  const [savingForced, setSavingForced] = useState(false);

  // Snapshot of the loaded values so we can disable each save button
  // unless its field has actually been edited.
  const [initialMax, setInitialMax] = useState('');
  const [initialForced, setInitialForced] = useState('');

  // Crash-engine card state — separate save buttons + dirty tracking
  // so a half-edit of the engine knobs doesn't get clobbered when the
  // user saves max-payout.
  const [engineSnap, setEngineSnap] = useState<CrashEngineSnapshot | null>(null);
  const [engineKind, setEngineKind] = useState<EngineKind>('legacy');
  const [engineMode, setEngineMode] = useState<CrashMode>('balanced');
  const [engineRtp, setEngineRtp] = useState('0.96');
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(true);
  const [initEngineKind, setInitEngineKind] = useState<EngineKind>('legacy');
  const [initEngineMode, setInitEngineMode] = useState<CrashMode>('balanced');
  const [initEngineRtp, setInitEngineRtp] = useState('0.96');
  const [initAdaptive, setInitAdaptive] = useState(true);
  const [savingEngine, setSavingEngine] = useState(false);

  // PR-AVIATOR-PAYOUT-CAP — separate state + dirty tracking so the
  // cap card behaves like the other cards (independent save, no
  // half-edit clobbering).
  const [capEnabled, setCapEnabled] = useState(true);
  const [capMaxCoins, setCapMaxCoins] = useState(String(DEFAULT_CAP_COINS));
  const [initCapEnabled, setInitCapEnabled] = useState(true);
  const [initCapMaxCoins, setInitCapMaxCoins] = useState(
    String(DEFAULT_CAP_COINS),
  );
  const [savingCap, setSavingCap] = useState(false);

  async function refresh() {
    try {
      const [data, engine, cap] = await Promise.all([
        api.get<AviatorSettings>('/admin/aviator/settings'),
        api.get<CrashEngineSnapshot>('/admin/aviator/crash-engine'),
        // PR-AVIATOR-PAYOUT-CAP — non-fatal if the endpoint is
        // missing (e.g. a stale backend during a rolling deploy).
        // We catch + default to the spec values so the UI never
        // blocks the rest of the page on this one fetch.
        api
          .get<PayoutCapConfig>('/admin/aviator/payout-cap')
          .catch(
            (): PayoutCapConfig => ({
              enabled: true,
              maxCoins: DEFAULT_CAP_COINS,
            }),
          ),
      ]);
      const mp = data.maxPayout ?? '';
      const fp = data.forcedNextPayout ?? '';
      setMaxPayout(mp);
      setForced(fp);
      setInitialMax(mp);
      setInitialForced(fp);
      if (fp) setAdvanced(true);

      setEngineSnap(engine);
      const kind: EngineKind = engine.engineEnabled ? 'heavytail' : 'legacy';
      const mode = engine.baseMode.toLowerCase() as CrashMode;
      const rtp = engine.targetRtp.toString();
      setEngineKind(kind);
      setEngineMode(mode);
      setEngineRtp(rtp);
      setAdaptiveEnabled(engine.adaptiveEnabled);
      setInitEngineKind(kind);
      setInitEngineMode(mode);
      setInitEngineRtp(rtp);
      setInitAdaptive(engine.adaptiveEnabled);

      // PR-AVIATOR-PAYOUT-CAP — hydrate cap card.
      const capCoinsStr = String(cap.maxCoins);
      setCapEnabled(cap.enabled);
      setCapMaxCoins(capCoinsStr);
      setInitCapEnabled(cap.enabled);
      setInitCapMaxCoins(capCoinsStr);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveEngine(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);

    const rtpNum = Number(engineRtp);
    if (!Number.isFinite(rtpNum) || rtpNum < 0.5 || rtpNum > 0.999) {
      setError('RTP must be a number in [0.5, 0.999]');
      return;
    }

    // Confirm when enabling — this is a payout-shaping change.
    if (engineKind === 'heavytail' && initEngineKind === 'legacy') {
      const ok = window.confirm(
        `Switch to the heavy-tail crash engine for all future rounds?\n\nThis changes the multiplier distribution. The legacy engine remains the fallback — flip back any time. RTP at C_ref will be locked to ${rtpNum}.`,
      );
      if (!ok) return;
    }

    setSavingEngine(true);
    try {
      const body: Record<string, unknown> = {};
      if (engineKind !== initEngineKind) body.engine = engineKind;
      if (engineRtp !== initEngineRtp) body.rtp = rtpNum;
      if (engineMode !== initEngineMode) body.mode = engineMode;
      if (adaptiveEnabled !== initAdaptive) body.adaptiveEnabled = adaptiveEnabled;
      const next = await api.patch<CrashEngineSnapshot>('/admin/aviator/crash-engine', body);
      setEngineSnap(next);
      setSaved('Crash-engine config saved. Effective on the next round.');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSavingEngine(false);
    }
  }

  async function saveMax(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setSavingMax(true);
    try {
      await api.patch('/admin/aviator/settings', {
        maxPayout: maxPayout.trim() === '' ? null : maxPayout.trim(),
      });
      setSaved('Max payout updated.');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSavingMax(false);
    }
  }

  // PR-AVIATOR-PAYOUT-CAP — payout-cap save handler.
  async function saveCap(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);

    // Validate maxCoins client-side so the user sees the issue
    // immediately rather than waiting for a backend 400.
    const trimmed = capMaxCoins.trim();
    let coinsNum: number | null;
    if (trimmed === '') {
      // Empty = reset to default per the spec.
      coinsNum = null;
    } else {
      coinsNum = Number(trimmed);
      if (
        !Number.isFinite(coinsNum) ||
        !Number.isInteger(coinsNum) ||
        coinsNum < 1
      ) {
        setError('Maximum payout must be a positive whole number (or empty to reset to 20 000).');
        return;
      }
    }

    // Explicit confirmation when DISABLING — spec verbatim. The
    // OK gate ensures this is never one missed click away.
    if (initCapEnabled && !capEnabled) {
      const ok = window.confirm(DISABLE_CAP_WARNING);
      if (!ok) {
        // Snap the toggle back so the UI reflects what the server
        // still has, not the unsaved intent.
        setCapEnabled(true);
        return;
      }
    }

    setSavingCap(true);
    try {
      const body: { enabled?: boolean; maxCoins?: number | null } = {};
      if (capEnabled !== initCapEnabled) body.enabled = capEnabled;
      if (trimmed !== initCapMaxCoins) body.maxCoins = coinsNum;

      // Defensive: if nothing actually changed (user clicked save
      // by accident), bail before hitting the API.
      if (Object.keys(body).length === 0) {
        setSaved('No changes to save.');
        return;
      }

      await api.patch<PayoutCapConfig>('/admin/aviator/payout-cap', body);
      setSaved(
        capEnabled
          ? `Payout cap saved — max ${capMaxCoins || DEFAULT_CAP_COINS} coins per bet. Effective on the next round.`
          : 'Payout cap DISABLED. Effective on the next round — monitor closely.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSavingCap(false);
    }
  }

  async function saveForced(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (forced.trim() !== '') {
      const ok = window.confirm(
        `Force the next round to crash at exactly ${forced}×?\n\nThis fires once — the very next round flies to that multiplier, then aviator returns to normal.`,
      );
      if (!ok) return;
    }
    setSavingForced(true);
    try {
      await api.patch('/admin/aviator/settings', {
        forcedNextPayout: forced.trim() === '' ? null : forced.trim(),
      });
      setSaved(
        forced.trim() === ''
          ? 'Forced-payout override cleared.'
          : 'Forced-payout queued for the next round.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSavingForced(false);
    }
  }

  if (loading) return <div className="text-slate-500">Loading…</div>;

  const maxDirty = maxPayout.trim() !== initialMax.trim();
  const forcedDirty = forced.trim() !== initialForced.trim();
  const engineDirty =
    engineKind !== initEngineKind ||
    engineMode !== initEngineMode ||
    engineRtp.trim() !== initEngineRtp.trim() ||
    adaptiveEnabled !== initAdaptive;
  // PR-AVIATOR-PAYOUT-CAP — dirty when either field deviates from
  // the saved snapshot. The toggle is a primitive bool comparison;
  // the input is a trimmed-string compare so leading/trailing
  // whitespace doesn't enable the save button on its own.
  const capDirty =
    capEnabled !== initCapEnabled ||
    capMaxCoins.trim() !== initCapMaxCoins.trim();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Aviator controls</h1>
      <p className="text-sm text-slate-500 mb-6">
        Tune the crash distribution engine, set a global payout ceiling, and
        queue one-off forced payouts.
      </p>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3 mb-4">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3 mb-4">
          {saved}
        </div>
      )}

      {/* ── Crash distribution engine ───────────────────────────── */}
      <form
        onSubmit={saveEngine}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Crash distribution engine
            </h2>
            <p className="text-[12px] text-slate-500">
              Picks the multiplier each round. Legacy is the existing 1-in-33
              insta-crash + 1/x tail; heavy-tail adds configurable RTP,
              volatility modes, and adaptive exposure blending.
            </p>
          </div>
          {engineSnap && (
            <span
              className={
                'inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' +
                (engineSnap.engineEnabled
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700')
              }
            >
              {engineSnap.engineEnabled ? 'Heavy-tail live' : 'Legacy'}
            </span>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Engine</span>
            <select
              value={engineKind}
              onChange={(e) => setEngineKind(e.target.value as EngineKind)}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded bg-white"
            >
              <option value="legacy">Legacy (existing 1/x with 1-in-33 edge)</option>
              <option value="heavytail">Heavy-tail (configurable RTP + modes)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Target RTP <span className="text-slate-400">(1 − house edge)</span>
            </span>
            <input
              value={engineRtp}
              onChange={(e) => setEngineRtp(e.target.value)}
              disabled={engineKind === 'legacy'}
              inputMode="decimal"
              pattern="0?\.\d+"
              placeholder="0.96"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Base mode</span>
            <select
              value={engineMode}
              onChange={(e) => setEngineMode(e.target.value as CrashMode)}
              disabled={engineKind === 'legacy'}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="balanced">Balanced (default)</option>
              <option value="fast_loss">Fast loss (house-protection)</option>
              <option value="streamer">Streamer (jackpot moments)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={adaptiveEnabled}
              onChange={(e) => setAdaptiveEnabled(e.target.checked)}
              disabled={engineKind === 'legacy'}
              className="rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">
              Adaptive blending
              <span className="text-slate-400 ml-1 text-[12px]">
                (EMA exposure → auto-shift modes)
              </span>
            </span>
          </label>
        </div>

        {engineSnap?.engineEnabled && (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-700">
            <div className="grid sm:grid-cols-3 gap-3 mb-2">
              <div>
                <div className="text-slate-500 uppercase tracking-wide text-[10px]">
                  Active mode
                </div>
                <div className="font-medium">{engineSnap.activeMode}</div>
              </div>
              <div>
                <div className="text-slate-500 uppercase tracking-wide text-[10px]">
                  Exposure factor
                </div>
                <div className="font-medium">
                  {engineSnap.exposureFactor.toFixed(3)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 uppercase tracking-wide text-[10px]">
                  Analytic RTP @ {engineSnap.params.cRef.toFixed(1)}×
                </div>
                <div className="font-medium">
                  {(engineSnap.analyticRtpAtRef * 100).toFixed(2)}%
                </div>
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wide text-[10px] mb-1">
                Live bucket histogram (analytic)
              </div>
              <div className="space-y-1">
                {engineSnap.buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="inline-block w-20 text-slate-600">{b.label}</span>
                    <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden">
                      <div
                        className="h-full bg-brand-indigo"
                        style={{ width: `${Math.min(100, b.probability * 100 * 2)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums text-slate-600">
                      {(b.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Rounds observed: {engineSnap.exposure.roundsObserved} · Rolling
              realised RTP:{' '}
              {engineSnap.exposure.smoothedStake > 0
                ? (engineSnap.exposure.rollingRtp * 100).toFixed(1) + '%'
                : '—'}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={savingEngine || !engineDirty}
            className="px-4 py-2 bg-brand-indigo text-white rounded text-sm font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingEngine ? 'Saving…' : 'Save engine config'}
          </button>
          {!savingEngine && !engineDirty && (
            <span className="text-xs text-slate-500">No changes to save.</span>
          )}
        </div>
      </form>

      <form
        onSubmit={saveMax}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-4"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Max payout (×)</span>
          <input
            value={maxPayout}
            onChange={(e) => setMaxPayout(e.target.value)}
            placeholder="leave empty for uncapped"
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            className="mt-1 w-full max-w-xs px-3 py-2 border border-slate-300 rounded"
          />
        </label>
        <p className="text-[12px] text-slate-500 mt-2">
          When set, every round&apos;s crash multiplier is clipped to this
          ceiling before publication. The provably-fair RNG still runs the
          same way — this is a visible cap on the outcome, not a tilt of the
          odds. Leave empty to remove the cap.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={savingMax || !maxDirty}
            className="px-4 py-2 bg-brand-indigo text-white rounded text-sm font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingMax ? 'Saving…' : 'Save max payout'}
          </button>
          {!savingMax && !maxDirty && (
            <span className="text-xs text-slate-500">No changes to save.</span>
          )}
        </div>
      </form>

      {/* PR-AVIATOR-PAYOUT-CAP — per-bet settlement-side cap card.
          Distinct from "Max payout" above (which clips the crash
          multiplier itself, affecting the whole round). This card
          caps each bet's payout independently; the plane keeps
          flying for everyone else. */}
      <form
        onSubmit={saveCap}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Payout cap (per bet)</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Caps each player&apos;s individual payout. Other players are
              unaffected — the plane keeps flying. Settles automatically
              when a player&apos;s live payout reaches the cap.
            </p>
          </div>
          <label
            className="flex items-center gap-2 select-none cursor-pointer"
            title={capEnabled ? 'Cap is ENABLED' : 'Cap is DISABLED — high risk'}
          >
            <input
              type="checkbox"
              checked={capEnabled}
              onChange={(e) => setCapEnabled(e.target.checked)}
              className="h-4 w-4 accent-brand-indigo"
              aria-label="Enable payout cap"
            />
            <span
              className={`text-xs font-bold ${
                capEnabled ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {capEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Maximum payout per round (coins / INR)
          </span>
          <input
            value={capMaxCoins}
            onChange={(e) => setCapMaxCoins(e.target.value)}
            placeholder={`leave empty to reset to ${DEFAULT_CAP_COINS.toLocaleString()}`}
            inputMode="numeric"
            pattern="\d*"
            disabled={!capEnabled}
            className="mt-1 w-full max-w-xs px-3 py-2 border border-slate-300 rounded disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <p className="text-[12px] text-slate-500 mt-2">
          Default <strong>{DEFAULT_CAP_COINS.toLocaleString()} coins</strong>.
          When a bet&apos;s payout would exceed this value, the player auto-
          cashes out at exactly the cap line and sees &quot;MAX PAYOUT REACHED&quot;.
          The cap is snapshotted at the start of each round — admin edits
          take effect on the NEXT round (live bets keep the cap they
          were placed under).
        </p>

        {!capEnabled && (
          <div className="mt-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
            ⚠ Cap is currently DISABLED. Payouts are unbounded — a single
            high-multiplier round on a large bet can expose the platform
            to extreme loss. Re-enable above unless you have a specific
            short-window reason to leave it off.
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={savingCap || !capDirty}
            className="px-4 py-2 bg-brand-indigo text-white rounded text-sm font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingCap ? 'Saving…' : 'Save payout cap'}
          </button>
          {!savingCap && !capDirty && (
            <span className="text-xs text-slate-500">No changes to save.</span>
          )}
        </div>
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-amber-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-3 bg-amber-50 text-amber-900 hover:bg-amber-100 text-sm font-medium"
        >
          <span>
            Advanced{' '}
            {initialForced && (
              <span className="ml-2 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                Forced @ {initialForced}×
              </span>
            )}
          </span>
          <span aria-hidden>{advanced ? '▾' : '▸'}</span>
        </button>
        {advanced && (
          <form onSubmit={saveForced} className="p-6 border-t border-amber-200">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Force next round&apos;s payout (×)
              </span>
              <input
                value={forced}
                onChange={(e) => setForced(e.target.value)}
                placeholder="e.g. 2.50 — leave empty to disarm"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                className="mt-1 w-full max-w-xs px-3 py-2 border border-slate-300 rounded"
              />
            </label>
            <p className="text-[12px] text-slate-500 mt-2">
              Saving a non-empty value queues a one-shot: the very next round
              crashes at exactly this multiplier (clipped by the max payout
              above, if any). The backend consumes the value atomically when
              the next BETTING phase opens, so subsequent rounds revert to
              the provably-fair RNG.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={savingForced || !forcedDirty}
                className="px-4 py-2 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingForced ? 'Saving…' : forced.trim() === '' ? 'Disarm' : 'Queue forced payout'}
              </button>
              {!savingForced && !forcedDirty && (
                <span className="text-xs text-slate-500">No changes to save.</span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
