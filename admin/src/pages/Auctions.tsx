import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

interface Auction {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  retailPrice: string;
  coinsPerBid: number;
  startsAt: string | null;
  endsAt: string;
  closedAt: string | null;
  status: 'UPCOMING' | 'LIVE' | 'ENDED';
  winnerId: string | null;
  winnerAmount: string | null;
  winner?: { username: string } | null;
}

type Filter = 'ALL' | 'LIVE' | 'UPCOMING' | 'ENDED';

export default function Auctions() {
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  async function refresh() {
    setError(null);
    try {
      const data = await api.get<Auction[]>('/auctions');
      setAuctions(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  async function closeNow(id: string) {
    if (!confirm('Close this auction now and pick a winner?')) return;
    try {
      await api.post(`/admin/auctions/${id}/close`, {});
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'close failed');
    }
  }

  async function startNow(id: string) {
    if (!confirm('Start this auction now? It will go LIVE immediately.')) return;
    try {
      await api.post(`/admin/auctions/${id}/start`, {});
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'start failed');
    }
  }

  async function deleteAuction(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This also removes any bids placed on it.`)) return;
    try {
      await api.delete(`/admin/auctions/${id}`);
      await refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'delete failed');
    }
  }

  const counts = useMemo(() => {
    const c = { ALL: 0, LIVE: 0, UPCOMING: 0, ENDED: 0 };
    for (const a of auctions ?? []) {
      c.ALL++;
      c[a.status]++;
    }
    return c;
  }, [auctions]);

  const filtered = (auctions ?? []).filter(
    (a) => filter === 'ALL' || a.status === filter,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-semibold">Auctions</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'LIVE', 'UPCOMING', 'ENDED'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                  filter === f
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f} <span className="text-slate-400">({counts[f]})</span>
              </button>
            ))}
          </div>
          <Link
            to="/auctions/new"
            className="px-3 py-2 bg-brand-indigo text-white rounded text-sm font-medium hover:bg-brand-indigo-dark transition"
          >
            New auction
          </Link>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {!auctions ? (
        <div className="text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-500">No auctions match this filter.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <AuctionCard
              key={a.id}
              a={a}
              onClose={() => closeNow(a.id)}
              onStart={() => startNow(a.id)}
              onDelete={() => deleteAuction(a.id, a.title)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AuctionCard({
  a,
  onClose,
  onStart,
  onDelete,
}: {
  a: Auction;
  onClose: () => void;
  onStart: () => void;
  onDelete: () => void;
}) {
  const cover = a.imageUrls[0];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col">
      <div className="relative aspect-video bg-slate-100">
        {cover ? (
          <img src={cover} alt={a.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
            no image
          </div>
        )}
        <StatusBadge status={a.status} />
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-semibold text-slate-900">{a.title}</h3>
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{a.description}</p>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="font-mono">₹{a.retailPrice}</span>
          <span className="text-slate-500">{a.coinsPerBid} 🪙 /bid</span>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {a.status === 'UPCOMING' && a.startsAt && (
            <>Starts {new Date(a.startsAt).toLocaleString()}</>
          )}
          {a.status === 'LIVE' && <>Ends {new Date(a.endsAt).toLocaleString()}</>}
          {a.status === 'ENDED' && a.closedAt && (
            <>Closed {new Date(a.closedAt).toLocaleString()}</>
          )}
        </div>
        {a.status === 'ENDED' && (
          <div className="mt-2 text-xs">
            {a.winner ? (
              <span className="text-emerald-700">
                Winner: <strong>{a.winner.username}</strong> @ ₹{a.winnerAmount}
              </span>
            ) : (
              <span className="text-slate-500">No winner — no unique bids.</span>
            )}
          </div>
        )}
        <div className="mt-auto pt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {a.status !== 'ENDED' && (
            <Link
              to={`/auctions/${a.id}/edit`}
              className="text-brand-indigo hover:underline"
            >
              Edit
            </Link>
          )}
          {a.status === 'UPCOMING' && (
            <button onClick={onStart} className="text-emerald-700 hover:underline">
              Start now
            </button>
          )}
          {a.status === 'LIVE' && (
            <button onClick={onClose} className="text-brand-indigo hover:underline">
              Close now
            </button>
          )}
          {/* The bid inspector lists every bid (incl. ringmaster phantoms)
              with sort + filter — available for LIVE auctions during a
              fight and for ENDED auctions for post-mortem audit. */}
          <Link
            to={`/auctions/${a.id}/bids`}
            className="text-slate-700 hover:underline"
          >
            Bids
          </Link>
          <button onClick={onDelete} className="ml-auto text-red-600 hover:underline">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Auction['status'] }) {
  const colors =
    status === 'LIVE'
      ? 'bg-orange-500 text-white'
      : status === 'UPCOMING'
      ? 'bg-blue-500 text-white'
      : 'bg-slate-700 text-white';
  return (
    <span className={`absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold tracking-wider rounded ${colors}`}>
      {status}
    </span>
  );
}
