"use client";

import useSWR from "swr";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "@/components/ui/Toaster";
import { Button } from "@/components/ui/Button";
import { ReportButton } from "@/components/ReportButton";
import { timeAgo } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  likeCount: number;
  parentId: string | null;
  user: { username: string };
  replies?: CommentRow[];
}

export function Comments({
  marketId,
  canPost,
  initialData,
}: {
  marketId: string;
  canPost: boolean;
  /** Server-rendered comments used as SWR fallback so the thread paints
   *  immediately — important on the event page where many open SSE streams
   *  can otherwise starve the client fetch of an HTTP connection in dev. */
  initialData?: { comments: CommentRow[] };
}) {
  const { data: session } = useSession();
  const { t: tr, locale } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myUsername = (session?.user as any)?.username as string | undefined;
  const { data, mutate, isLoading } = useSWR<{ comments: CommentRow[] }>(
    `/api/markets/${marketId}/comments`,
    fetcher,
    { refreshInterval: 8000, fallbackData: initialData },
  );
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // commentId currently showing its inline reply composer (Instagram-style).
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  // Locally-tracked liked comment ids + optimistic count deltas.
  const [liked, setLiked] = useState<Set<string>>(new Set());

  async function submit(text: string, parentId?: string) {
    const res = await fetch(`/api/markets/${marketId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parentId ? { body: text, parentId } : { body: text }),
    });
    if (!res.ok) {
      toast(tr("comments.couldntPost"), "err");
      return false;
    }
    void mutate();
    return true;
  }

  async function postTop(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const ok = await submit(body.trim());
    setBusy(false);
    if (ok) setBody("");
  }

  async function toggleLike(c: CommentRow) {
    const isLiked = liked.has(c.id);
    setLiked((prev) => {
      const next = new Set(prev);
      if (isLiked) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
    await fetch(`/api/markets/${marketId}/comments/${c.id}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ like: !isLiked }),
    }).catch(() => {});
    void mutate();
  }

  function CommentNode({
    c,
    isReply = false,
  }: {
    c: CommentRow;
    isReply?: boolean;
  }) {
    const isLiked = liked.has(c.id);
    const count = c.likeCount + (isLiked ? 1 : 0);
    return (
      <li
        className={`rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm ${
          isReply ? "ml-6 mt-2" : ""
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">
              {c.user.username}
            </span>
            <span>·</span>
            <span>{timeAgo(c.createdAt, locale)}</span>
          </div>
          {myUsername && (
            <ReportButton
              targetType="COMMENT"
              targetId={c.id}
              hidden={c.user.username === myUsername}
            />
          )}
        </div>
        <p className="text-slate-200">{c.body}</p>

        <div className="mt-2 flex items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() => toggleLike(c)}
            className={`flex items-center gap-1 font-medium transition ${
              isLiked ? "text-pink-400" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span aria-hidden>{isLiked ? "♥" : "♡"}</span>
            <span>{tr("comments.likeButton")}</span>
            {count > 0 && <span className="text-slate-500">· {count}</span>}
          </button>
          {!isReply && (
            <button
              type="button"
              onClick={() =>
                setReplyingTo((prev) => (prev === c.id ? null : c.id))
              }
              className="font-medium text-slate-400 transition hover:text-slate-200"
            >
              {tr("comments.replyButton")}
            </button>
          )}
        </div>

        {replyingTo === c.id && (
          <ReplyComposer
            onCancel={() => setReplyingTo(null)}
            onSubmit={async (text) => {
              const ok = await submit(text, c.id);
              if (ok) setReplyingTo(null);
            }}
          />
        )}

        {c.replies && c.replies.length > 0 && (
          <ul className="mt-1">
            {c.replies.map((r) => (
              <CommentNode key={r.id} c={r} isReply />
            ))}
          </ul>
        )}
      </li>
    );
  }

  function ReplyComposer({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (text: string) => void | Promise<void>;
    onCancel: () => void;
  }) {
    const [val, setVal] = useState("");
    const [sending, setSending] = useState(false);
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!val.trim()) return;
          setSending(true);
          await onSubmit(val.trim());
          setSending(false);
          setVal("");
        }}
        className="mt-2 ml-6 flex gap-2"
      >
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          maxLength={500}
          placeholder={tr("comments.replyPlaceholder")}
          className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        />
        <Button type="submit" disabled={sending || !val.trim()} size="sm">
          {tr("comments.replyButton")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {tr("comments.cancelButton")}
        </Button>
      </form>
    );
  }

  return (
    <div>
      {canPost ? (
        <form onSubmit={postTop} className="mb-3 flex gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            placeholder={tr("comments.placeholder")}
            className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          />
          <Button type="submit" disabled={busy || !body.trim()} size="sm">
            {tr("comments.postButton")}
          </Button>
        </form>
      ) : (
        <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
          {tr("comments.signInPrompt")}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
        </div>
      ) : (data?.comments ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">{tr("comments.emptyState")}</p>
      ) : (
        <ul className="space-y-2">
          {data?.comments.map((c) => (
            <CommentNode key={c.id} c={c} />
          ))}
        </ul>
      )}
    </div>
  );
}
