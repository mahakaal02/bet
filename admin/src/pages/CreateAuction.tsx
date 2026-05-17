import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import ImageManager from './ImageManager';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function CreateAuction() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [coinsPerBid, setCoinsPerBid] = useState(1);
  // Defaults: start 24h from now, end 4 days after start (so 5 days from now).
  // `startImmediately` toggles the startsAt input off — when on, the
  // auction goes LIVE the moment the admin clicks Create.
  const [startImmediately, setStartImmediately] = useState(false);
  const [startsAt, setStartsAt] = useState(() => defaultStartsAt());
  const [endsAt, setEndsAt] = useState(() => defaultEndsAt());
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // When the admin moves the start date, push the end date along with it
  // so the default "4 days after start" relationship is preserved UNTIL
  // they manually edit the end date. We detect manual edit via a sticky
  // flag — once set, automatic adjustments stop.
  const [endsAtEdited, setEndsAtEdited] = useState(false);
  useEffect(() => {
    if (endsAtEdited || startImmediately) return;
    const t = parseLocalInput(startsAt);
    if (!t) return;
    setEndsAt(formatLocalInput(new Date(t.getTime() + 4 * DAY_MS)));
  }, [startsAt, endsAtEdited, startImmediately]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      };
      // Omitting startsAt entirely (or passing null) tells the backend
      // to set status=LIVE immediately. See auctions.service.ts::create.
      if (startsDate) body.startsAt = startsDate.toISOString();
      await api.post('/admin/auctions', body);
      navigate('/auctions');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">New auction</h1>
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 max-w-2xl space-y-4"
      >
        <Field label="Product name">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Sony WH-1000XM5"
            className="w-full px-3 py-2 border border-slate-300 rounded"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={3}
            placeholder="What is the user winning? Condition, accessories, etc."
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
              placeholder="29990.00"
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
            Start immediately (go live the moment this is created)
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
            <p className="text-xs text-slate-500 mt-1">
              Defaults to 24 hours from now.
            </p>
          </Field>
          <Field label="Ends at">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => {
                setEndsAt(e.target.value);
                setEndsAtEdited(true);
              }}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded"
            />
            <p className="text-xs text-slate-500 mt-1">
              Defaults to 4 days after start.
            </p>
          </Field>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-brand-indigo text-white rounded font-medium hover:bg-brand-indigo-dark transition disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create auction'}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/**
 * Default start = now + 24 hours, snapped to the nearest minute. Returned
 * as a `datetime-local`-shaped string in the browser's local timezone so
 * the input renders without timezone surprises.
 */
function defaultStartsAt(): string {
  return formatLocalInput(new Date(Date.now() + DAY_MS));
}

/**
 * Default end = now + 5 days (start + 4 days). Snapped to the nearest
 * minute. The auto-sync effect above keeps this in lockstep with
 * `startsAt` until the admin manually edits it.
 */
function defaultEndsAt(): string {
  return formatLocalInput(new Date(Date.now() + 5 * DAY_MS));
}

function formatLocalInput(d: Date): string {
  const t = new Date(d);
  t.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/**
 * Parse a `datetime-local` input value into a Date, returning `null` on
 * the empty string / a malformed value. Lets the caller surface a clean
 * "invalid date" error instead of crashing on `Invalid Date.toISOString()`.
 */
function parseLocalInput(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
