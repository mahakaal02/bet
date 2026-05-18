import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

type BidStatus =
  | 'LOWEST_UNIQUE'
  | 'DUPLICATE_COLLIDING'
  | 'UNIQUE_LOSING'
  | 'NO_BID';

interface Bid {
  id: string;
  userId: string;
  username: string;
  amount: string;
  coinsAtBid: number;
  createdAt: string;
  statusAtPost: BidStatus;
  statusCurrent: BidStatus;
}

type SortKey =
  | 'createdAt'
  | 'username'
  | 'amount'
  | 'statusAtPost'
  | 'statusCurrent';

type SortDir = 'asc' | 'desc';

const STATUS_LABEL: Record<BidStatus, string> = {
  LOWEST_UNIQUE: 'Lowest & Unique',
  DUPLICATE_COLLIDING: 'Duplicate / Colliding',
  UNIQUE_LOSING: 'Unique Losing',
  NO_BID: '—',
};

const STATUS_TONE: Record<BidStatus, string> = {
  LOWEST_UNIQUE: 'bg-emerald-100 text-emerald-800',
  DUPLICATE_COLLIDING: 'bg-rose-100 text-rose-800',
  UNIQUE_LOSING: 'bg-amber-100 text-amber-800',
  NO_BID: 'bg-slate-100 text-slate-600',
};

/**
 * Admin "Bidding" inspector for a single auction. Shows every bid
 * (including ringmaster phantoms) with sort + filter controls so the
 * admin can audit the whole pool, replay placement order, and see how
 * each bid's status shifted from posting to now.
 */
export default function AuctionBids() {
  const { id } = useParams<{ id: string }>();
  const [bids, setBids] = useState<Bid[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [userFilter, setUserFilter] = useState('');
  const [postStatusFilter, setPostStatusFilter] = useState<'' | BidStatus>('');
  const [currentStatusFilter, setCurrentStatusFilter] = useState<'' | BidStatus>('');
  // Convenience toggle: ringmaster bids are noise for many audits.
  const [hideRingmaster, setHideRingmaster] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<Bid[]>(`/admin/auctions/${id}/bids`);
        if (!cancelled) setBids(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'failed to load bids');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const visible = useMemo(() => {
    if (!bids) return [];
    const needle = userFilter.trim().toLowerCase();
    const filtered = bids.filter((b) => {
      if (hideRingmaster && b.username === 'ringmaster') return false;
      if (needle && !b.username.toLowerCase().includes(needle)) return false;
      if (postStatusFilter && b.statusAtPost !== postStatusFilter) return false;
      if (currentStatusFilter && b.statusCurrent !== currentStatusFilter) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'createdAt') {
        diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortKey === 'amount') {
        diff = Number(a.amount) - Number(b.amount);
      } else if (sortKey === 'username') {
        diff = a.username.localeCompare(b.username);
      } else if (sortKey === 'statusAtPost') {
        diff = a.statusAtPost.localeCompare(b.statusAtPost);
      } else {
        diff = a.statusCurrent.localeCompare(b.statusCurrent);
      }
      return sortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [
    bids,
    userFilter,
    postStatusFilter,
    currentStatusFilter,
    hideRingmaster,
    sortKey,
    sortDir,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function clearFilters() {
    setUserFilter('');
    setPostStatusFilter('');
    setCurrentStatusFilter('');
    setHideRingmaster(false);
  }

  const totalCoinsSpent = useMemo(
    () =>
      (bids ?? [])
        .filter((b) => b.username !== 'ringmaster')
        .reduce((acc, b) => acc + b.coinsAtBid, 0),
    [bids],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link to="/auctions" className="text-xs text-slate-500 hover:text-slate-700">
            ← Back to auctions
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Bidding log</h1>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Total real bids</div>
          <div className="text-lg font-semibold">
            {(bids ?? []).filter((b) => b.username !== 'ringmaster').length}
            <span className="text-xs text-slate-400 ml-2">
              · {totalCoinsSpent} 🪙 spent
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          type="text"
          placeholder="Filter by username…"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded text-sm w-48"
        />
        <SelectFilter
          label="Status at post"
          value={postStatusFilter}
          onChange={(v) => setPostStatusFilter(v as '' | BidStatus)}
        />
        <SelectFilter
          label="Current status"
          value={currentStatusFilter}
          onChange={(v) => setCurrentStatusFilter(v as '' | BidStatus)}
        />
        <label className="inline-flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={hideRingmaster}
            onChange={(e) => setHideRingmaster(e.target.checked)}
            className="rounded border-slate-300"
          />
          Hide ringmaster
        </label>
        {(userFilter || postStatusFilter || currentStatusFilter || hideRingmaster) && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-slate-700 ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {!bids ? (
        <div className="text-slate-500">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-slate-500">
          {bids.length === 0 ? 'No bids placed yet.' : 'No bids match the filters.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <SortHeader
                  label="Time"
                  active={sortKey === 'createdAt'}
                  dir={sortDir}
                  onClick={() => toggleSort('createdAt')}
                />
                <SortHeader
                  label="User"
                  active={sortKey === 'username'}
                  dir={sortDir}
                  onClick={() => toggleSort('username')}
                />
                <th className="px-3 py-2 text-left font-medium">User ID</th>
                <SortHeader
                  label="Amount"
                  active={sortKey === 'amount'}
                  dir={sortDir}
                  onClick={() => toggleSort('amount')}
                  align="right"
                />
                <th className="px-3 py-2 text-right font-medium">Coins</th>
                <SortHeader
                  label="At post"
                  active={sortKey === 'statusAtPost'}
                  dir={sortDir}
                  onClick={() => toggleSort('statusAtPost')}
                />
                <SortHeader
                  label="Current"
                  active={sortKey === 'statusCurrent'}
                  dir={sortDir}
                  onClick={() => toggleSort('statusCurrent')}
                />
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => {
                const isRingmaster = b.username === 'ringmaster';
                return (
                  <tr
                    key={b.id}
                    className={`border-t border-slate-200 ${
                      isRingmaster ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      @{b.username}
                      {isRingmaster && (
                        <span className="ml-1 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                          ringmaster
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 font-mono">
                      {b.userId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 text-right font-mono">₹{b.amount}</td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {isRingmaster ? '—' : b.coinsAtBid}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip s={b.statusAtPost} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip s={b.statusCurrent} />
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

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-slate-900 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {label}
      <span
        className={`ml-1 text-[10px] ${active ? 'text-slate-700' : 'text-slate-300'}`}
      >
        {active ? (dir === 'asc' ? '▲' : '▼') : '▾'}
      </span>
    </th>
  );
}

function StatusChip({ s }: { s: BidStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[s]}`}
    >
      {STATUS_LABEL[s]}
    </span>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-slate-700">
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 border border-slate-300 rounded text-sm"
      >
        <option value="">All</option>
        <option value="LOWEST_UNIQUE">Lowest & Unique</option>
        <option value="DUPLICATE_COLLIDING">Duplicate / Colliding</option>
        <option value="UNIQUE_LOSING">Unique Losing</option>
      </select>
    </label>
  );
}
