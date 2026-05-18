import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface AviatorSettings {
  maxPayout: string | null;
  forcedNextPayout: string | null;
  updatedAt: string;
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

  async function refresh() {
    try {
      const data = await api.get<AviatorSettings>('/admin/aviator/settings');
      const mp = data.maxPayout ?? '';
      const fp = data.forcedNextPayout ?? '';
      setMaxPayout(mp);
      setForced(fp);
      setInitialMax(mp);
      setInitialForced(fp);
      if (fp) setAdvanced(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

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

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Aviator controls</h1>
      <p className="text-sm text-slate-500 mb-6">
        Tune the Aviator crash ceiling and queue one-off forced payouts.
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
