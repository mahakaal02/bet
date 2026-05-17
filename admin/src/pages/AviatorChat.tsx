import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface ChatRow {
  id: string;
  userId: string;
  username: string;
  contact: string | null;
  message: string;
  createdAt: string;
}

export default function AviatorChat() {
  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function refresh() {
    setError(null);
    try {
      setRows(await api.get<ChatRow[]>('/admin/aviator/chat?limit=200'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this chat message? Other users will keep their local copy until they reload.'))
      return;
    setBusyId(id);
    try {
      await api.delete(`/admin/aviator/chat/${id}`);
      setRows((cur) => cur?.filter((r) => r.id !== id) ?? null);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'delete failed');
    } finally {
      setBusyId(null);
    }
  }

  const filtered = (rows ?? []).filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.username.toLowerCase().includes(q) ||
      r.message.toLowerCase().includes(q) ||
      (r.contact ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-semibold">Aviator chat</h1>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by user or text…"
          className="px-3 py-1.5 border border-slate-300 rounded text-sm w-72 outline-none focus:border-brand-indigo"
        />
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {!rows ? (
        <div className="text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-500 text-sm">No messages matching this filter.</div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.username}</div>
                    <div className="text-xs text-slate-500">{r.contact ?? r.userId.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 max-w-md break-words">{r.message}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(r.id)}
                      disabled={busyId === r.id}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
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
