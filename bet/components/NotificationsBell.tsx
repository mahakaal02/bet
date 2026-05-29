"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Bell } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";
import { toast } from "@/components/ui/Toaster";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Notif {
  id: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ListResp {
  items: Notif[];
  unread: number;
}

/**
 * Bell icon in the navbar with unread badge + dropdown. Connects to the
 * per-user SSE stream (`/api/me/stream`) — server-driven so a notification
 * created by another tab / market resolution shows up here instantly without
 * polling.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { locale } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR<ListResp>("/api/notifications", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  // Subscribe to per-user push events. Each "notification" tick revalidates
  // the bell list; each "achievement_unlocked" pops a toast.
  useEffect(() => {
    const src = new EventSource("/api/me/stream");
    src.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "notification" || data.type === "achievement_unlocked") {
          void mutate();
          // Also revalidate any other components keyed on these endpoints.
          void globalMutate("/api/me/achievements");
          void globalMutate("/api/me");
        }
        if (data.type === "achievement_unlocked") {
          toast(`${data.icon} ${data.title} unlocked! +${data.rewardCoins} coins`, "ok");
        }
      } catch {
        /* malformed event — drop */
      }
    };
    return () => src.close();
  }, [mutate]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function markAll() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    void mutate();
  }

  const unread = data?.unread ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1.5 rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fade-up absolute end-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-[11px] text-cyan-300 hover:text-cyan-200"
                >
                  Mark all read
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                See all
              </Link>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!data ? (
              <div className="space-y-2 p-3">
                <div className="skeleton h-10 w-full" />
                <div className="skeleton h-10 w-full" />
              </div>
            ) : data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {data.items.slice(0, 10).map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "px-3 py-2.5 text-sm hover:bg-slate-900/60",
                      !n.readAt && "bg-cyan-500/5",
                    )}
                  >
                    <Link
                      href={n.href ?? "#"}
                      onClick={() => setOpen(false)}
                      className="block"
                    >
                      <div className="flex items-start gap-2">
                        {!n.readAt && (
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
                        )}
                        <div className="flex-1">
                          <div className="font-semibold text-slate-100">
                            {n.title}
                          </div>
                          <div className="text-xs text-slate-400 line-clamp-2">
                            {n.body}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            {timeAgo(n.createdAt, locale)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
