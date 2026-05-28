import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

interface CoinPack {
  id: string;
  coins: number;
  /** USD anchor price; every local price is PPP-derived from this. */
  baseUsdPrice: string | null;
  active: boolean;
  sortOrder: number;
}

/** Shape of GET /admin/pricing/preview — live PPP conversion for a country. */
interface PreviewPack {
  coinPackId: string;
  coins: number;
  currency: string;
  price: string;
}
interface PreviewResp {
  country: string;
  currency: string;
  hasSnapshot: boolean;
  effectiveYear?: number;
  packs: PreviewPack[];
}

// The markets the PPP engine prices directly (mirrors the backend
// COUNTRY_CATALOG). Selecting any of these recomputes the local price
// live from each pack's USD anchor — no sync required.
const PREVIEW_COUNTRIES = [
  { code: 'US', label: 'United States · USD' },
  { code: 'IN', label: 'India · INR' },
  { code: 'GB', label: 'United Kingdom · GBP' },
  { code: 'FR', label: 'France · EUR' },
  { code: 'BR', label: 'Brazil · BRL' },
  { code: 'MX', label: 'Mexico · MXN' },
  { code: 'JP', label: 'Japan · JPY' },
  { code: 'TR', label: 'Türkiye · TRY' },
  { code: 'NG', label: 'Nigeria · NGN' },
  { code: 'ID', label: 'Indonesia · IDR' },
  { code: 'PH', label: 'Philippines · PHP' },
  { code: 'AE', label: 'United Arab Emirates · AED' },
  { code: 'CN', label: 'China · CNY' },
  { code: 'CH', label: 'Switzerland · CHF' },
  { code: 'RU', label: 'Russia · RUB' },
  { code: 'ZA', label: 'South Africa · ZAR' },
];

export default function CoinPacks() {
  const [packs, setPacks] = useState<CoinPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coins, setCoins] = useState(100);
  const [usd, setUsd] = useState('0.99');
  const [creating, setCreating] = useState(false);

  const [previewCountry, setPreviewCountry] = useState('IN');
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setPacks(await api.get<CoinPack[]>('/admin/coin-packs'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  async function loadPreview(country: string) {
    setPreviewErr(null);
    try {
      setPreview(
        await api.get<PreviewResp>(`/admin/pricing/preview?country=${country}`),
      );
    } catch (e) {
      setPreview(null);
      setPreviewErr(e instanceof ApiError ? e.message : 'preview failed');
    }
  }

  useEffect(() => {
    refresh();
  }, []);
  // Dynamic: any country change re-fetches the live preview immediately.
  useEffect(() => {
    loadPreview(previewCountry);
  }, [previewCountry]);

  // coinPackId -> converted price for the selected country.
  const localByPackId = new Map<string, PreviewPack>();
  preview?.packs.forEach((p) => localByPackId.set(p.coinPackId, p));

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.post('/admin/coin-packs', {
        coins: Number(coins),
        baseUsdPrice: usd,
      });
      await refresh();
      await loadPreview(previewCountry);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  async function editUsd(p: CoinPack) {
    const next = prompt(
      `New USD price for the ${p.coins}-coin pack (e.g. 1.99):`,
      p.baseUsdPrice ?? '',
    );
    if (next == null) return;
    if (!/^\d+(\.\d{1,2})?$/.test(next.trim())) {
      alert('Enter a number with up to 2 decimals, e.g. 1.99');
      return;
    }
    try {
      await api.patch(`/admin/coin-packs/${p.id}`, { baseUsdPrice: next.trim() });
      await refresh();
      await loadPreview(previewCountry);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'update failed');
    }
  }

  async function toggle(p: CoinPack) {
    try {
      await api.patch(`/admin/coin-packs/${p.id}`, { active: !p.active });
      await refresh();
      await loadPreview(previewCountry);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'update failed');
    }
  }

  async function remove(p: CoinPack) {
    if (!confirm(`Delete pack of ${p.coins} coins?`)) return;
    try {
      await api.delete(`/admin/coin-packs/${p.id}`);
      await refresh();
      await loadPreview(previewCountry);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'delete failed');
    }
  }

  const previewCurrency = preview?.currency ?? previewCountry;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Coin packs</h1>
      <p className="text-sm text-slate-500 mb-6 max-w-2xl">
        Packs are priced in <strong>USD</strong>; every local-currency price is
        PPP-derived from that anchor. One pack per coin amount — adding a pack
        replaces any existing pack with the same number of coins. The Local
        column previews the conversion live; to charge users the new price,
        publish it with a sync on{' '}
        <Link to="/pricing" className="text-brand-indigo hover:underline">
          Regional pricing
        </Link>
        .
      </p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      <form
        onSubmit={create}
        className="bg-white border border-slate-200 rounded-lg p-4 mb-6 flex items-end gap-3 max-w-2xl"
      >
        <label className="block flex-1">
          <span className="text-xs font-medium text-slate-600">Coins</span>
          <input
            type="number"
            min={1}
            value={coins}
            onChange={(e) => setCoins(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded"
            required
          />
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-slate-600">Price (USD $)</span>
          <input
            type="text"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            pattern="\d+(\.\d{1,2})?"
            placeholder="0.99"
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded"
            required
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
        >
          {creating ? 'Adding…' : 'Add pack'}
        </button>
      </form>

      <div className="flex items-center gap-2 mb-3 max-w-3xl">
        <span className="text-xs font-medium text-slate-600">
          Preview local price for
        </span>
        <select
          value={previewCountry}
          onChange={(e) => setPreviewCountry(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded text-sm"
        >
          {PREVIEW_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        {preview && !preview.hasSnapshot && (
          <span className="text-xs text-amber-600">
            no published snapshot yet — showing USD anchors
          </span>
        )}
        {previewErr && (
          <span className="text-xs text-red-600">{previewErr}</span>
        )}
      </div>

      {!packs ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden max-w-3xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Coins</th>
                <th className="px-4 py-3 font-medium">Price (USD)</th>
                <th className="px-4 py-3 font-medium">
                  Local ({previewCurrency})
                </th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => {
                const local = localByPackId.get(p.id);
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">{p.coins.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {p.baseUsdPrice != null ? (
                        <button
                          onClick={() => editUsd(p)}
                          className="text-slate-900 hover:text-brand-indigo hover:underline"
                          title="Edit USD price"
                        >
                          ${Number(p.baseUsdPrice).toFixed(2)}
                        </button>
                      ) : (
                        <button
                          onClick={() => editUsd(p)}
                          className="text-amber-600 hover:underline"
                          title="Set USD price"
                        >
                          set USD…
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {local ? (
                        <span className="text-slate-700">
                          {local.currency} {local.price}
                        </span>
                      ) : p.active ? (
                        <span className="text-slate-400">…</span>
                      ) : (
                        <span
                          className="text-slate-400"
                          title="Inactive packs aren't priced"
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggle(p)}
                        className={p.active ? 'text-emerald-600' : 'text-slate-400'}
                      >
                        {p.active ? 'active' : 'disabled'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(p)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
