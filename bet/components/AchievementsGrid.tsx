"use client";

import useSWR from "swr";
import { cn, fmtCoins } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Achievement {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  rewardCoins: number;
  rewardXp: number;
  unlockedAt: string | null;
}

interface Response {
  items: Achievement[];
  unlockedCount: number;
  totalCount: number;
}

export function AchievementsGrid() {
  const { locale } = useTranslation();
  // Refresh frequently — the user-event SSE in NotificationsBell will trigger
  // a global revalidate via SWR's mutate when an unlock arrives, but a 30s
  // safety poll catches anything we missed.
  const { data } = useSWR<Response>("/api/me/achievements", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {data.unlockedCount} of {data.totalCount} unlocked ·{" "}
          <a
            href="/achievements"
            className="text-cyan-300 hover:text-cyan-200"
          >
            see all →
          </a>
        </span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500"
            style={{
              width: `${Math.round(
                (data.unlockedCount / Math.max(1, data.totalCount)) * 100,
              )}%`,
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.items.map((a) => (
          <div
            key={a.id}
            className={cn(
              "fade-up rounded-xl border p-3 transition",
              a.unlockedAt
                ? "border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-indigo-500/5"
                : "border-slate-800 bg-slate-900/40 opacity-60",
            )}
            title={
              a.unlockedAt
                ? `Unlocked ${new Date(a.unlockedAt).toLocaleString(locale)}`
                : "Locked"
            }
          >
            <div
              className={cn(
                "mb-1 text-2xl",
                a.unlockedAt ? "" : "grayscale opacity-50",
              )}
            >
              {a.icon}
            </div>
            <div className="text-sm font-bold text-slate-100">{a.title}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              {a.description}
            </p>
            <div className="mt-1.5 text-[10px] font-mono text-slate-500">
              +{fmtCoins(a.rewardCoins, locale)} 🪙 · +{a.rewardXp} XP
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
