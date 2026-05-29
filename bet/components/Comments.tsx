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

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  user: { username: string };
}

export function Comments({
  marketId,
  canPost,
}: {
  marketId: string;
  canPost: boolean;
}) {
  const { data: session } = useSession();
  const { t: tr, locale } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myUsername = (session?.user as any)?.username as string | undefined;
  const { data, mutate, isLoading } = useSWR<{ comments: CommentRow[] }>(
    `/api/markets/${marketId}/comments`,
    fetcher,
    { refreshInterval: 8000 },
  );
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/markets/${marketId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (!res.ok) {
      toast(tr("comments.couldntPost"), "err");
      return;
    }
    setBody("");
    void mutate();
  }

  return (
    <div>
      {canPost ? (
        <form onSubmit={post} className="mb-3 flex gap-2">
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
            <li
              key={c.id}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm"
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
