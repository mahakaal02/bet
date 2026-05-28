import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * PPP regional-pricing admin.
 *
 * Read + light-edit surface over the yearly pricing snapshots:
 *   - history list (every yearly run)
 *   - selected snapshot: forex rates, PPP multipliers, the generated
 *     per-country price grid with app-store tier suggestions
 *   - actions: run a sync (draft or publish), publish a draft,
 *     override a single price, override a PPP multiplier
 *
 * Mirrors the existing admin page conventions (api.ts, table styling,
 * inline errors). Gated server-side by `pricing.view` / `pricing.sync`.
 */

interface SnapshotSummary {
  id: string;
  effectiveYear: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'FAILED';
  isActive: boolean;
  baselineCountry: string;
  forexSource: string;
  pppSource: string;
  generatedAt: string;
  notes: string | null;
  _count?: { rows: number };
}

interface ForexRate {
  id: string;
  currencyCode: string;
  usdRate: string;
}
interface PppFactor {
  id: string;
  countryCode: string;
  rawPppValue: string | null;
  normalizedMultiplier: string;
  isFallback: boolean;
}
interface PricingRow {
  id: string;
  countryCode: string;
  currencyCode: string;
  coinPack: { coins: number; sku: string | null };
  baseUsdPrice: string;
  forexRate: string;
  pppMultiplier: string;
  calculatedLocalPrice: string;
  roundedFinalPrice: string;
  appStoreTier?: { tierPrice: string; label: string; exact: boolean };
}
interface SnapshotDetail extends SnapshotSummary {
  forexRates: ForexRate[];
  pppFactors: PppFactor[];
  rows: PricingRow[];
}

export default function Pricing() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [selected, setSelected] = useState<SnapshotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const list = await api.get<SnapshotSummary[]>('/admin/pricing/snapshots');
      setSnapshots(list);
      if (list.length && !selected) await openSnapshot(list[0].id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  async function openSnapshot(id: string) {
    try {
      setSelected(await api.get<SnapshotDetail>(`/admin/pricing/snapshots/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load snapshot');
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSync(publish: boolean) {
    if (
      !confirm(
        publish
          ? 'Run the annual pricing sync and PUBLISH it now? This replaces the live pricing.'
          : 'Generate a DRAFT pricing snapshot for the current year? (Not published.)',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/pricing/sync', { publish });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function publish(id: string) {
    if (!confirm('Publish this snapshot? It becomes the live pricing.')) return;
    setBusy(true);
    try {
      await api.post(`/admin/pricing/snapshots/${id}/publish`, {});
      await refresh();
      await openSnapshot(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  async function overridePrice(row: PricingRow) {
    const next = prompt(
      `Override ${row.countryCode} ${row.currencyCode} price for ${row.coinPack.coins} coins:`,
      row.roundedFinalPrice,
    );
    if (!next) return;
    try {
      await api.patch(`/admin/pricing/rows/${row.id}`, { roundedFinalPrice: next });
      if (selected) await openSnapshot(selected.id);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'override failed');
    }
  }

  async function overrideMultiplier(f: PppFactor) {
    const next = prompt(
      `Override PPP multiplier for ${f.countryCode}:`,
      f.normalizedMultiplier,
    );
    if (!next) return;
    try {
      await api.patch(`/admin/pricing/ppp/${f.id}`, { multiplier: next });
      if (selected) await openSnapshot(selected.id);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'override failed');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Regional pricing (PPP)</h1>
        <div className="flex gap-2">
          <button
            onClick={() => runSync(false)}
            disabled={busy}
            className="px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            Generate draft
          </button>
          <button
            onClick={() => runSync(true)}
            disabled={busy}
            className="px-3 py-2 text-sm bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sync & publish'}
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      <p className="text-sm text-slate-500 mb-6 max-w-3xl">
        Gameplay coin values are global; only the fiat price to buy coins
        varies by country. Prices are frozen into a yearly snapshot
        (synced each April 1 UTC) so the user-facing price is stable.
        Forex from exchangerate.host, affordability from the World Bank.
      </p>

      {/* History */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Year</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Rows</th>
              <th className="px-4 py-3 font-medium">Generated</th>
              <th className="px-4 py-3 font-medium">Sources</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(snapshots ?? []).map((s) => (
              <tr
                key={s.id}
                className={`border-t border-slate-100 ${
                  selected?.id === s.id ? 'bg-indigo-50/50' : ''
                }`}
              >
                <td className="px-4 py-3 font-medium">{s.effectiveYear}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      s.status === 'PUBLISHED'
                        ? 'text-emerald-600'
                        : s.status === 'DRAFT'
                          ? 'text-amber-600'
                          : 'text-slate-400'
                    }
                  >
                    {s.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3">{s._count?.rows ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(s.generatedAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {s.forexSource}
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button
                    onClick={() => openSnapshot(s.id)}
                    className="text-xs text-brand-indigo hover:underline"
                  >
                    View
                  </button>
                  {s.status === 'DRAFT' && (
                    <button
                      onClick={() => publish(s.id)}
                      className="text-xs text-emerald-600 hover:underline"
                    >
                      Publish
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {snapshots?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No pricing snapshots yet — run “Sync &amp; publish”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          {/* Forex + PPP side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Panel title={`Forex rates (1 USD = …) · ${selected.forexSource}`}>
              <MiniTable
                head={['Currency', 'Rate']}
                rows={selected.forexRates.map((f) => [f.currencyCode, f.usdRate])}
              />
            </Panel>
            <Panel title={`PPP multipliers · baseline ${selected.baselineCountry}=1.0`}>
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-left">
                  <tr>
                    <th className="py-1 font-medium">Country</th>
                    <th className="py-1 font-medium">Raw</th>
                    <th className="py-1 font-medium">Multiplier</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {selected.pppFactors.map((f) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="py-1.5">{f.countryCode}</td>
                      <td className="py-1.5 text-slate-500">
                        {f.rawPppValue ?? '—'}
                      </td>
                      <td className="py-1.5">
                        {f.normalizedMultiplier}
                        {f.isFallback && (
                          <span
                            className="ml-1 text-amber-600"
                            title="fallback / clamped — review"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => overrideMultiplier(f)}
                          className="text-xs text-brand-indigo hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>

          {/* Generated price grid */}
          <Panel title="Generated local prices (with app-store tier suggestion)">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Country</th>
                  <th className="py-1 font-medium">Coins</th>
                  <th className="py-1 font-medium">Cur</th>
                  <th className="py-1 font-medium">Base USD</th>
                  <th className="py-1 font-medium">×Mult</th>
                  <th className="py-1 font-medium">×Forex</th>
                  <th className="py-1 font-medium">Computed</th>
                  <th className="py-1 font-medium">Final</th>
                  <th className="py-1 font-medium">Store tier</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {selected.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1.5">{r.countryCode}</td>
                    <td className="py-1.5">{r.coinPack.coins}</td>
                    <td className="py-1.5">{r.currencyCode}</td>
                    <td className="py-1.5 text-slate-500">${r.baseUsdPrice}</td>
                    <td className="py-1.5 text-slate-500">{r.pppMultiplier}</td>
                    <td className="py-1.5 text-slate-500">{r.forexRate}</td>
                    <td className="py-1.5 text-slate-400">{r.calculatedLocalPrice}</td>
                    <td className="py-1.5 font-semibold">{r.roundedFinalPrice}</td>
                    <td className="py-1.5 text-slate-500">
                      {r.appStoreTier?.tierPrice}
                      {r.appStoreTier && !r.appStoreTier.exact && (
                        <span className="ml-1 text-amber-500" title={r.appStoreTier.label}>
                          ≈
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => overridePrice(r)}
                        className="text-xs text-brand-indigo hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-slate-500 text-left">
        <tr>
          {head.map((h) => (
            <th key={h} className="py-1 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-100">
            {r.map((c, j) => (
              <td key={j} className="py-1.5">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
