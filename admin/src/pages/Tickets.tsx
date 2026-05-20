import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin support inbox (PR-TICKETS-1).
 *
 *   1. List — filterable by status / category / assignee. Default
 *      sort surfaces SLA-warmest tickets first.
 *   2. Detail — full thread including internal notes.
 *   3. Actions — public reply, internal note, assign, escalate, close.
 *
 * SLA breach (admin hasn't responded by `slaDueAt`) shows a red pill
 * so the queue eye can lock onto it first.
 */

type Status = 'OPEN' | 'AWAITING_USER' | 'AWAITING_ADMIN' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
type Category = 'ACCOUNT' | 'WITHDRAWAL' | 'DEPOSIT' | 'BIDDING' | 'AVIATOR' | 'ORDER_FULFILLMENT' | 'TECHNICAL' | 'OTHER';
type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

interface QueueRow {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  subject: string;
  category: Category;
  priority: Priority;
  status: Status;
  slaDueAt: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageRow {
  id: string;
  senderId: string;
  isFromAdmin: boolean;
  isInternal: boolean;
  body: string;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  userId: string;
  subject: string;
  category: Category;
  priority: Priority;
  status: Status;
  slaDueAt: string;
  firstResponseAt: string | null;
  assignedToId: string | null;
  messages: MessageRow[];
  createdAt: string;
}

export default function Tickets() {
  const [items, setItems] = useState<QueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | ''>('');
  const [category, setCategory] = useState<Category | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (category) params.set('category', category);
        if (cursor) params.set('cursor', cursor);
        const res = await api.get<{ items: QueueRow[]; nextCursor: string | null }>(`/admin/tickets?${params.toString()}`);
        if (cursor) {
          setItems((prev) => [...prev, ...res.items]);
        } else {
          setItems(res.items);
        }
        setNextCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load.');
      } finally {
        setLoading(false);
      }
    },
    [status, category],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    setSelectedId(id);
    setReply('');
    setInternal(false);
    try {
      setDetail(await api.get<TicketDetail>(`/admin/tickets/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load thread.');
    }
  }, []);

  const send = useCallback(
    async (kind: 'reply' | 'internal') => {
      if (!detail) return;
      if (reply.trim().length < 1) return;
      setBusy(true);
      setError(null);
      try {
        await api.post(`/admin/tickets/${detail.id}/reply`, {
          body: reply.trim(),
          isInternal: kind === 'internal',
        });
        setReply('');
        await open(detail.id);
        void load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to send.');
      } finally {
        setBusy(false);
      }
    },
    [detail, reply, open, load],
  );

  const escalate = useCallback(async () => {
    if (!detail) return;
    const reason = prompt('Escalation reason?');
    if (!reason || reason.trim().length < 4) return;
    setBusy(true);
    try {
      await api.post(`/admin/tickets/${detail.id}/escalate`, { reason: reason.trim() });
      await open(detail.id);
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to escalate.');
    } finally {
      setBusy(false);
    }
  }, [detail, open, load]);

  const close = useCallback(
    async (reason: 'RESOLVED' | 'DUPLICATE' | 'INVALID' | 'NO_RESPONSE') => {
      if (!detail) return;
      setBusy(true);
      try {
        await api.post(`/admin/tickets/${detail.id}/close`, { reason });
        await open(detail.id);
        void load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to close.');
      } finally {
        setBusy(false);
      }
    },
    [detail, open, load],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">Support tickets</h1>
        <p className="mt-1 text-sm text-slate-600">SLA-warmest first. Internal notes are hidden from the user.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status | '')}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All open</option>
            <option value="OPEN">Open</option>
            <option value="AWAITING_USER">Awaiting user</option>
            <option value="AWAITING_ADMIN">Awaiting admin</option>
            <option value="ESCALATED">Escalated</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category | '')}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="ACCOUNT">Account</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="DEPOSIT">Deposit</option>
            <option value="BIDDING">Bidding</option>
            <option value="AVIATOR">Aviator</option>
            <option value="ORDER_FULFILLMENT">Order</option>
            <option value="TECHNICAL">Technical</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">SLA</th>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">Inbox zero.</td>
                </tr>
              )}
              {items.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => void open(t.id)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selectedId === t.id ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-xs">
                    {t.slaBreached ? (
                      <span className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-bold text-red-700">BREACH</span>
                    ) : (
                      <span className="text-slate-600">{new Date(t.slaDueAt).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">@{t.username}</td>
                  <td className="px-3 py-2"><span className="block truncate">{t.subject}</span></td>
                  <td className="px-3 py-2 text-xs">{t.status.replace(/_/g, ' ').toLowerCase()}</td>
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

        <div className="rounded border border-slate-200 bg-white p-4">
          {!detail && <p className="text-sm text-slate-500">Pick a ticket.</p>}
          {detail && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">{detail.subject}</h2>
                <p className="text-xs text-slate-500">
                  {detail.category.replace(/_/g, ' ').toLowerCase()} · {detail.priority.toLowerCase()} · {detail.status.replace(/_/g, ' ').toLowerCase()}
                </p>
              </div>

              <div className="max-h-96 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded p-2 text-sm ${
                      m.isInternal
                        ? 'border border-amber-300 bg-amber-50 text-amber-900'
                        : m.isFromAdmin
                          ? 'bg-cyan-50 text-cyan-900'
                          : 'bg-white text-slate-700'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      {m.isInternal ? 'Internal note' : m.isFromAdmin ? 'Admin' : 'User'} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                  </div>
                ))}
              </div>

              <textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Reply…"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                maxLength={5000}
              />

              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                Internal note (hidden from user)
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || reply.trim().length < 1}
                  onClick={() => void send(internal ? 'internal' : 'reply')}
                  className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {internal ? 'Save note' : 'Send reply'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void escalate()}
                  className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Escalate
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void close('RESOLVED')}
                  className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Close (resolved)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void close('NO_RESPONSE')}
                  className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Close (no response)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
