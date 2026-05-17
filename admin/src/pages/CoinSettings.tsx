import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Settings {
  inrPerCoin: string;
  defaultCoinsPerBid: number;
}

export default function CoinSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [inr, setInr] = useState('');
  const [coinsPerBid, setCoinsPerBid] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Settings>('/admin/coin-settings')
      .then((s) => {
        setSettings(s);
        setInr(s.inrPerCoin);
        setCoinsPerBid(s.defaultCoinsPerBid);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'load failed'));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await api.patch<Settings>('/admin/coin-settings', {
        inrPerCoin: inr,
        defaultCoinsPerBid: Number(coinsPerBid),
      });
      setSettings(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Coin economy</h1>
      <p className="text-sm text-slate-500 mb-6">
        These values control the price users pay for coins and how many coins each bid costs. Changes
        propagate within ~60s (Redis cache TTL).
      </p>

      {!settings && !error && <div className="text-slate-500">Loading…</div>}

      {settings && (
        <form
          onSubmit={onSubmit}
          className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 max-w-xl space-y-4"
        >
          <label className="block">
            <span className="text-xs font-medium text-slate-600">INR per coin (₹)</span>
            <input
              value={inr}
              onChange={(e) => setInr(e.target.value)}
              required
              pattern="\d+(\.\d{1,2})?"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Default coins per bid</span>
            <input
              type="number"
              min={1}
              value={coinsPerBid}
              onChange={(e) => setCoinsPerBid(Number(e.target.value))}
              required
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded"
            />
            <p className="text-xs text-slate-500 mt-1">
              Individual auctions can override this. Premium auctions might set 5 coins per bid.
            </p>
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {saved && <div className="text-sm text-emerald-600">Saved.</div>}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </div>
  );
}
