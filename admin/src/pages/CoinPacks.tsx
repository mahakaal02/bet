import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface CoinPack {
  id: string;
  coins: number;
  priceInr: string;
  active: boolean;
  sortOrder: number;
}

export default function CoinPacks() {
  const [packs, setPacks] = useState<CoinPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coins, setCoins] = useState(50);
  const [price, setPrice] = useState('250.00');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setPacks(await api.get<CoinPack[]>('/admin/coin-packs'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/admin/coin-packs', { coins: Number(coins), priceInr: price });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  async function toggle(p: CoinPack) {
    try {
      await api.patch(`/admin/coin-packs/${p.id}`, { active: !p.active });
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'update failed');
    }
  }

  async function remove(p: CoinPack) {
    if (!confirm(`Delete pack of ${p.coins} coins?`)) return;
    try {
      await api.delete(`/admin/coin-packs/${p.id}`);
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'delete failed');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Coin packs</h1>

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
          <span className="text-xs font-medium text-slate-600">Price (₹)</span>
          <input
            type="text"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            pattern="\d+(\.\d{1,2})?"
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

      {!packs ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden max-w-2xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Coins</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{p.coins}</td>
                  <td className="px-4 py-3">₹{p.priceInr}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
