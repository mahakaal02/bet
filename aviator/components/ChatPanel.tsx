'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/store';
import { getSocket } from '@/lib/socket';
import { getUser } from '@/lib/auth';

const COLORS = ['#FF4D5A', '#FF8C42', '#2EE59D', '#FFCD56', '#8A6BFF', '#5DADE2'];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function relative(now: number, iso: string) {
  const t = new Date(iso).getTime();
  const dSec = Math.floor((now - t) / 1000);
  if (dSec < 5) return 'now';
  if (dSec < 60) return `${dSec}s`;
  if (dSec < 3600) return `${Math.floor(dSec / 60)}m`;
  return `${Math.floor(dSec / 3600)}h`;
}

export default function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const me = typeof window === 'undefined' ? null : getUser()?.username ?? null;

  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Keep a re-rendering "now" for the relative-time labels.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to bottom on new message (only if user is near bottom already).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const sock = getSocket();
    sock.emit('CHAT_SEND', { message: text }, (ack?: { ok: boolean; error?: string }) => {
      setSending(false);
      if (ack && ack.ok === false) {
        setError(ack.error ?? 'send failed');
      } else {
        setDraft('');
      }
    });
  }

  return (
    <aside className="glass rounded-3xl flex flex-col" style={{ minHeight: 320, maxHeight: 460 }}>
      <h2 className="text-xs uppercase tracking-widest text-text-secondary px-4 pt-4">
        Live chat
      </h2>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-2 mt-2 space-y-1 text-sm"
      >
        {chat.length === 0 ? (
          <p className="text-text-secondary text-xs">
            Be the first to say something.
          </p>
        ) : (
          chat.map((m) => {
            const isMe = me === m.username;
            const color = colorFor(m.username);
            return (
              <div key={m.id} className="leading-snug">
                <span
                  className="font-semibold mr-1.5 text-xs"
                  style={{ color }}
                >
                  {m.username}
                  {isMe && <span className="text-text-secondary text-[10px] ml-1">(you)</span>}
                </span>
                <span className="text-text-primary text-sm break-words">{m.message}</span>
                <span className="text-text-secondary text-[10px] ml-2">
                  {relative(now, m.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={send}
        className="px-3 pb-3 pt-2 border-t border-divider flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={280}
          placeholder="Say something…"
          className="flex-1 bg-elevated border border-divider rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-orange"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="px-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-[var(--color-accent-red)] to-[#FF7A59] hover:brightness-110 transition disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {error && <p className="px-4 pb-3 text-xs text-accent-red">{error}</p>}
    </aside>
  );
}
