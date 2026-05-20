import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin KYC review queue (PR-KYC-2).
 *
 * Three responsibilities, mirroring the auctions audit-log page:
 *
 *   1. **List** — paginated `/admin/kyc?state=PENDING`. Filter chips
 *      for review state (default PENDING) + document kind.
 *   2. **Preview** — clicking a row opens the inline document
 *      preview by hitting `/admin/kyc/:id/file`. The backend
 *      decrypts + serves the bytes — `<img>` or `<embed>` based on
 *      mime. **Every preview is audited** server-side; the UI
 *      surfaces no warning beyond that.
 *   3. **Decide** — approve / reject / request-resubmit with notes
 *      required for the rejects. The mutation result lifts the
 *      user's KYC tier when appropriate (response includes
 *      `newTier` so the chip can update without a refetch).
 */

type DocumentKind =
  | 'PAN'
  | 'AADHAAR_LAST4'
  | 'PASSPORT'
  | 'VOTER_ID'
  | 'ADDRESS_PROOF'
  | 'SELFIE'
  | 'LIVENESS_VIDEO';

type ReviewState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REQUIRES_RESUBMIT';

interface QueueRow {
  documentId: string;
  userId: string;
  username: string;
  email: string | null;
  currentTier: string;
  kind: DocumentKind;
  virusScanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  reviewState: ReviewState;
  fileSizeBytes: number;
  mimeType: string;
  submittedAt: string;
}

interface ListResponse {
  items: QueueRow[];
  nextCursor: string | null;
}

const KIND_LABEL: Record<DocumentKind, string> = {
  PAN: 'PAN',
  AADHAAR_LAST4: 'Aadhaar (last 4)',
  PASSPORT: 'Passport',
  VOTER_ID: 'Voter ID',
  ADDRESS_PROOF: 'Address proof',
  SELFIE: 'Selfie',
  LIVENESS_VIDEO: 'Liveness video',
};

export default function KycReview() {
  const [items, setItems] = useState<QueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<ReviewState>('PENDING');
  const [kindFilter, setKindFilter] = useState<DocumentKind | ''>('');
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('state', state);
        if (kindFilter) params.set('kind', kindFilter);
        if (cursor) params.set('cursor', cursor);
        const res = await api.get<ListResponse>(`/admin/kyc?${params.toString()}`);
        if (cursor) {
          setItems((prev) => [...prev, ...res.items]);
        } else {
          setItems(res.items);
        }
        setNextCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load queue.');
      } finally {
        setLoading(false);
      }
    },
    [state, kindFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openPreview = useCallback(async (row: QueueRow) => {
    setSelected(row);
    setNotes('');
    setPreviewUrl(null);
    setPreviewMime(row.mimeType);
    try {
      // The /file endpoint returns the decrypted bytes; we wrap them
      // in a blob URL so a single <img>/<embed> sees them. The blob
      // URL is revoked when the next preview opens.
      const blob = await api.getBlob(`/admin/kyc/${row.documentId}/file`);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load file.');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const decide = useCallback(
    async (verb: 'approve' | 'reject' | 'resubmit') => {
      if (!selected) return;
      if ((verb === 'reject' || verb === 'resubmit') && notes.trim().length < 4) {
        setError('Notes required (min 4 chars) for reject / resubmit.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await api.post(`/admin/kyc/${selected.documentId}/${verb}`, { notes: notes.trim() || undefined });
        // Pop the row out of the queue (filtered to PENDING by default).
        setItems((prev) => prev.filter((r) => r.documentId !== selected.documentId));
        setSelected(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Decision failed.');
      } finally {
        setBusy(false);
      }
    },
    [selected, notes],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">KYC review</h1>
        <p className="mt-1 text-sm text-slate-600">
          Approve / reject / request a fresh upload. Every document
          view is audited.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">State</span>
          <select
            value={state}
            onChange={(e) => setState(e.target.value as ReviewState)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="PENDING">Pending</option>
            <option value="REQUIRES_RESUBMIT">Requires resubmit</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Document kind</span>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as DocumentKind | '')}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Queue list */}
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Submitted</th>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Scan</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    Nothing matches.
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <tr
                  key={row.documentId}
                  onClick={() => void openPreview(row)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selected?.documentId === row.documentId ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {new Date(row.submittedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    @{row.username}
                    {row.email && <div className="text-[11px] text-slate-500">{row.email}</div>}
                  </td>
                  <td className="px-3 py-2">{KIND_LABEL[row.kind]}</td>
                  <td className="px-3 py-2 text-xs">{row.currentTier.replace('TIER_', 'T')}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.virusScanStatus === 'INFECTED' ? (
                      <span className="text-red-700">⚠ Infected</span>
                    ) : row.virusScanStatus === 'CLEAN' ? (
                      <span className="text-emerald-700">Clean</span>
                    ) : (
                      <span className="text-amber-700">{row.virusScanStatus}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button
                type="button"
                onClick={() => void load(nextCursor)}
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              >
                Load more
              </button>
            </div>
          )}
        </div>

        {/* Preview + decision */}
        <div className="rounded border border-slate-200 bg-white p-4">
          {!selected && <p className="text-sm text-slate-500">Pick a row to preview.</p>}
          {selected && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {KIND_LABEL[selected.kind]} for @{selected.username}
                </h2>
                <p className="text-xs text-slate-500">
                  Tier {selected.currentTier.replace('TIER_', '')} ·{' '}
                  {Math.round(selected.fileSizeBytes / 1024)} KB · {selected.mimeType}
                </p>
              </div>

              <div className="grid place-items-center rounded border border-slate-200 bg-slate-50 p-2">
                {previewUrl ? (
                  previewMime?.startsWith('image/') ? (
                    <img src={previewUrl} alt="" className="max-h-96 max-w-full object-contain" />
                  ) : (
                    <embed src={previewUrl} type={previewMime ?? undefined} className="h-96 w-full" />
                  )
                ) : (
                  <p className="py-12 text-sm text-slate-500">Decrypting…</p>
                )}
              </div>

              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (required for reject / resubmit)"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                maxLength={500}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('approve')}
                  className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('resubmit')}
                  className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Request resubmit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('reject')}
                  className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
