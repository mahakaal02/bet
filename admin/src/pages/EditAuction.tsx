import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import ImageManager from './ImageManager';

type ManipulationMode = 'NORMAL' | 'NO_WINNER' | 'FIXED_WINNER';

interface Auction {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  retailPrice: string;
  coinsPerBid: number;
  startsAt: string | null;
  endsAt: string;
  status: 'UPCOMING' | 'LIVE' | 'ENDED';
  /** Default NORMAL. Backend stores it on every Auction row. */
  manipulationMode: ManipulationMode;
  /** Set when manipulationMode === FIXED_WINNER. Decimal string. */
  fixedWinningAmount: string | null;
}

export default function EditAuction() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [coinsPerBid, setCoinsPerBid] = useState(1);
  const [startImmediately, setStartImmediately] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<Auction['status']>('UPCOMING');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced (manipulation) controls. Hidden under a disclosure so they
  // don't surface to casual admin edits — these change auction outcomes,
  // they're not regular product fields.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fixedWinningAmount, setFixedWinningAmount] = useState('');
  const [noWinner, setNoWinner] = useState(false);
  /** Convert checkbox / amount into the canonical mode string the API expects.
   *  NO_WINNER takes precedence over FIXED_WINNER (they're mutually
   *  exclusive — fixed amount is ignored when the kill switch is on). */
  const manipulationMode: ManipulationMode = noWinner
    ? 'NO_WINNER'
    : fixedWinningAmount.trim()
      ? 'FIXED_WINNER'
      : 'NORMAL';

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const a = await api.get<Auction>(`/auctions/${id}`);
        if (cancelled) return;
        setTitle(a.title);
        setDescription(a.description);
        setRetailPrice(a.retailPrice);
        setCoinsPerBid(a.coinsPerBid);
        // No startsAt → was created with "Start immediately" or is already
        // LIVE. Surface that intent in the toggle so the admin sees why
        // the input is disabled.
        if (a.startsAt) {
          setStartsAt(toLocalInput(a.startsAt));
          setStartImmediately(false);
        } else {
          setStartsAt('');
          setStartImmediately(true);
        }
        setEndsAt(toLocalInput(a.endsAt));
        setImageUrls(a.imageUrls ?? []);
        setStatus(a.status);
        // Hydrate manipulation state from the server. If either advanced
        // control is non-default, open the disclosure so the admin sees
        // what's already wired without hunting for it.
        const mode = (a.manipulationMode ?? 'NORMAL') as ManipulationMode;
        setNoWinner(mode === 'NO_WINNER');
        setFixedWinningAmount(
          mode === 'FIXED_WINNER' ? a.fixedWinningAmount ?? '' : '',
        );
        if (mode !== 'NORMAL') setAdvancedOpen(true);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'failed to load auction');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);

    const endsDate = parseLocalInput(endsAt);
    if (!endsDate) {
      setError('end date is invalid');
      return;
    }
    let startsDate: Date | null = null;
    if (!startImmediately) {
      const parsed = parseLocalInput(startsAt);
      if (!parsed) {
        setError('start date is invalid');
        return;
      }
      startsDate = parsed;
      if (endsDate.getTime() <= startsDate.getTime()) {
        setError('end date must be after start date');
        return;
      }
    } else if (endsDate.getTime() <= Date.now()) {
      setError('end date must be in the future');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title,
        description,
        retailPrice,
        coinsPerBid: Number(coinsPerBid),
        endsAt: endsDate.toISOString(),
        imageUrls,
        // Explicit `null` tells the backend to clear startsAt and flip
        // status to LIVE (see auctions.service.ts::update).
        startsAt: startsDate ? startsDate.toISOString() : null,
        manipulationMode,
        // Send the fixed amount only for FIXED_WINNER; otherwise send
        // null so backend clears any stale value left over from a prior
        // mode flip.
        fixedWinningAmount:
          manipulationMode === 'FIXED_WINNER' ? fixedWinningAmount.trim() : null,
      };
      await api.patch(`/admin/auctions/${id}`, body);
      navigate('/auctions');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'save failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-slate-500">Loading…</div>;
  }

  if (status === 'ENDED') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-4">Edit auction</h1>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-4 max-w-2xl">
          This auction has already ended and cannot be edited.
        </div>
        <button
          type="button"
          onClick={() => navigate('/auctions')}
          className="mt-4 px-4 py-2 bg-slate-100 text-slate-700 rounded font-medium hover:bg-slate-200 transition"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Edit auction</h1>
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 max-w-2xl space-y-4"
      >
        <Field label="Product name">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded"
          />
        </Field>

        <Field label="Product images">
          <ImageManager value={imageUrls} onChange={setImageUrls} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Retail price (₹)">
            <input
              value={retailPrice}
              onChange={(e) => setRetailPrice(e.target.value)}
              required
              pattern="\d+(\.\d{1,2})?"
              className="w-full px-3 py-2 border border-slate-300 rounded"
            />
          </Field>
          <Field label="Coins per bid">
            <input
              type="number"
              min={1}
              value={coinsPerBid}
              onChange={(e) => setCoinsPerBid(Number(e.target.value))}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded"
            />
          </Field>
        </div>

        <div className="space-y-1">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={startImmediately}
              onChange={(e) => setStartImmediately(e.target.checked)}
              className="rounded border-slate-300"
            />
            Start immediately (go live as soon as this save lands)
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Starts at">
            <input
              type="datetime-local"
              value={startImmediately ? '' : startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={startImmediately}
              required={!startImmediately}
              className="w-full px-3 py-2 border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400"
            />
          </Field>
          <Field label="Ends at">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded"
            />
          </Field>
        </div>

        <AdvancedPanel
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          fixedWinningAmount={fixedWinningAmount}
          setFixedWinningAmount={setFixedWinningAmount}
          noWinner={noWinner}
          setNoWinner={setNoWinner}
          mode={manipulationMode}
        />

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/auctions')}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded font-medium hover:bg-slate-200 transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Hidden-by-default advanced controls. Two rigging knobs:
 *
 *   1. **Set winning bid** — the admin types an exact amount; the
 *      first bidder at that amount is declared the winner regardless
 *      of the natural lowest-unique outcome. Other users at the same
 *      amount see "Duplicate / Colliding". Empty = no override.
 *
 *   2. **No bid wins** — the "house always wins" kill switch. While
 *      ON, the backend's ringmaster sentinel user auto-places a
 *      duplicate against any bid that would have been "Lowest &
 *      Unique" — so no one ever wins. Turning it ON shows a
 *      confirmation modal so the admin can't fat-finger it.
 *
 * The two switches are mutually exclusive — when the kill switch is
 * on, the fixed-amount input is greyed out to avoid mixed-mode
 * confusion. The backend treats `NO_WINNER` as "ignore
 * fixedWinningAmount", which matches what the UI suggests.
 */
function AdvancedPanel({
  open,
  onToggle,
  fixedWinningAmount,
  setFixedWinningAmount,
  noWinner,
  setNoWinner,
  mode,
}: {
  open: boolean;
  onToggle: () => void;
  fixedWinningAmount: string;
  setFixedWinningAmount: (v: string) => void;
  noWinner: boolean;
  setNoWinner: (v: boolean) => void;
  mode: ManipulationMode;
}) {
  function onToggleKillSwitch(next: boolean) {
    if (next) {
      // Confirm before arming. The kill switch is a rigging tool —
      // accidental clicks should not silently nullify a live auction.
      const ok = window.confirm(
        '"No bid wins" disables natural winners for this auction. While ON, the ringmaster sentinel auto-collides every "Lowest & Unique" bid so no user ever wins. Continue?',
      );
      if (!ok) return;
    }
    setNoWinner(next);
  }

  return (
    <div className="border border-amber-200 rounded">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 bg-amber-50 text-amber-900 hover:bg-amber-100 rounded-t text-sm font-medium"
      >
        <span>
          Advanced{' '}
          {mode !== 'NORMAL' && (
            <span className="ml-2 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {mode === 'NO_WINNER' ? 'Kill switch on' : 'Fixed winner'}
            </span>
          )}
        </span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-4 text-sm bg-white rounded-b">
          <div>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Set winning bid (₹)
              </span>
              <input
                value={fixedWinningAmount}
                onChange={(e) => setFixedWinningAmount(e.target.value)}
                placeholder="e.g. 7.42 — leave empty for normal auction"
                pattern="\d+(\.\d{1,2})?"
                disabled={noWinner}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400"
              />
            </label>
            <p className="text-[11px] text-slate-500 mt-1">
              When set, the FIRST user to bid this exact amount wins. Other
              users who also bid this amount see &quot;Duplicate / Colliding&quot;.
              Empty = natural lowest-unique-bid rule.
            </p>
          </div>

          <div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={noWinner}
                onChange={(e) => onToggleKillSwitch(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">
                No bid wins{' '}
                <span
                  className={`ml-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    noWinner
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {noWinner ? 'ON' : 'OFF'}
                </span>
              </span>
            </label>
            <p className="text-[11px] text-slate-500 mt-1">
              While ON, the ringmaster sentinel auto-collides every &quot;Lowest
              &amp; Unique&quot; bid so no user ever wins. Bids placed while
              this is ON keep their statuses after you flip it OFF — the
              ringmaster&apos;s collision bids persist in the bid history.
            </p>
          </div>

          {noWinner && fixedWinningAmount.trim() && (
            <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900 text-xs">
              <strong>Heads up:</strong> &quot;No bid wins&quot; overrides the
              fixed amount. The fixed value is preserved but ignored while
              the kill switch is on.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInput(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
