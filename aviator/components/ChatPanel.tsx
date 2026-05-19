'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/store';
import { getSocket } from '@/lib/socket';
import { getUser } from '@/lib/auth';

const USERNAME_PALETTE = [
  '#8B5CFF', '#3DD9FF', '#22E0BD', '#FFC857',
  '#FF8A3D', '#FF4D9A', '#5DADE2', '#A78BFA',
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USERNAME_PALETTE[h % USERNAME_PALETTE.length];
}

function relative(now: number, iso: string) {
  const t = new Date(iso).getTime();
  const dSec = Math.floor((now - t) / 1000);
  if (dSec < 5) return 'now';
  if (dSec < 60) return `${dSec}s`;
  if (dSec < 3600) return `${Math.floor(dSec / 60)}m`;
  return `${Math.floor(dSec / 3600)}h`;
}

/**
 * Live chat — minimal, premium. Messages animate in, sender colours
 * are deterministic per username (matching the roster + winners panels
 * so the same player wears the same colour everywhere), relative
 * timestamps update on a 15-second tick.
 */
export default function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const me = typeof window === 'undefined' ? null : getUser()?.username ?? null;

  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll on new message — only if the user was already near
  // the bottom, so an upward scroll-to-history isn't yanked back.
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
    sock.emit(
      'CHAT_SEND',
      { message: text },
      (ack?: { ok: boolean; error?: string }) => {
        setSending(false);
        if (ack && ack.ok === false) setError(ack.error ?? 'send failed');
        else setDraft('');
      },
    );
  }

  return (
    <aside
      className="glass rounded-3xl flex flex-col overflow-hidden"
      style={{ minHeight: 320, maxHeight: 460 }}
    >
      <header className="px-4 pt-4 pb-3 border-b border-divider flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.20em] text-text-secondary">
          Live chat
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-success font-bold uppercase tracking-[0.18em]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success glow-breath" />
          Online
        </span>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto scroll-cool px-3 py-2 space-y-1 text-sm"
      >
        {chat.length === 0 ? (
          <p className="text-text-muted text-xs py-2">
            Be the first to say something.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {chat.map((m) => {
              const isMe = me === m.username;
              const color = colorFor(m.username);
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="leading-snug px-1 py-0.5"
                >
                  <span
                    className="font-bold mr-1.5 text-xs"
                    style={{ color }}
                  >
                    {m.username}
                    {isMe && (
                      <span className="text-text-muted text-[10px] ml-1 font-medium">
                        you
                      </span>
                    )}
                  </span>
                  <span className="text-text-primary text-sm break-words">
                    {m.message}
                  </span>
                  <span className="text-text-muted text-[10px] ml-2 tabular-nums">
                    {relative(now, m.createdAt)}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
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
          className="flex-1 bg-elevated border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-aurora-violet/70 transition"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-br from-aurora-violet to-[#5C2BFF] hover:brightness-110 transition disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </aside>
  );
}
