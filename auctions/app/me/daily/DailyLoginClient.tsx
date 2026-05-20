"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DailyLoginState } from "./page";

/**
 * Daily-login claim CTA + streak ribbon.
 *
 * Two views:
 *
 *   1. **Claimable** — banner with the day-number, reward coins,
 *      and an "earned" hint if a streak freeze would be spent
 *      ("you missed yesterday but we'll cover it").
 *   2. **Already claimed** — countdown to next UTC midnight.
 *      Re-fetches on the minute so the countdown drifts no more
 *      than a minute behind real time.
 *
 * The 30-day streak ribbon below shows day pills 1..30 with the
 * current/next claim highlighted and the milestone days flagged.
 * It's just a strip of `<li>` — no graphics dependency.
 */
export function DailyLoginClient({
  initial,
}: {
  initial: DailyLoginState;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState<{
    dayNumber: number;
    rewardCoins: number;
    bonus: string | null;
  } | null>(null);

  // Tick the countdown once a minute so the displayed time stays
  // current even if the user leaves the tab open.
  const [, force] = useState(0);
  useEffect(() => {
    if (!state.nextClaimAt) return;
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [state.nextClaimAt]);

  async function claim() {
    if (busy || state.claimedToday) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/daily-login/claim", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't claim today's reward.");
        return;
      }
      setJustClaimed({
        dayNumber: body?.dayNumber,
        rewardCoins: body?.rewardCoins,
        bonus: body?.bonus ?? null,
      });
      // Refresh server state so the wallet chip in the navbar reflects
      // the new balance and the page re-renders into "already claimed".
      const next = await fetch("/api/me/daily-login", { cache: "no-store" });
      if (next.ok) setState((await next.json()) as DailyLoginState);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const nextClaimMs = state.nextClaimAt
    ? new Date(state.nextClaimAt).getTime() - Date.now()
    : 0;
  const currentDay = state.streak;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Current streak
            </div>
            <div className="text-3xl font-black text-cyan-300">
              {state.streak} day{state.streak === 1 ? "" : "s"}
            </div>
            {state.streakFreezes > 0 && (
              <div className="mt-1 text-[11px] text-slate-400">
                {state.streakFreezes} freeze
                {state.streakFreezes === 1 ? "" : "s"} saved — covers a missed
                day if your streak is 7+
              </div>
            )}
          </div>
          {state.claimedToday ? (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-emerald-300">
                Claimed today
              </div>
              <div className="text-sm text-slate-300">
                Next reward in {humaniseDuration(nextClaimMs)}
              </div>
            </div>
          ) : (
            state.nextClaim && (
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-amber-300">
                  Today&apos;s reward
                </div>
                <div className="text-2xl font-black text-amber-200">
                  +{state.nextClaim.rewardCoins.toLocaleString("en-IN")}
                </div>
                <div className="text-[11px] text-slate-500">
                  Day {state.nextClaim.dayNumber}
                  {state.nextClaim.bonus && (
                    <span className="ml-1 text-amber-300">
                      · {state.nextClaim.bonus.replace("_", " ")} bonus
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {!state.claimedToday && state.nextClaim?.freezeWouldBeSpent && (
          <div className="mt-3 rounded border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100">
            You missed a day — we&apos;ll spend a streak freeze so your
            count stays at day {state.nextClaim.dayNumber}.
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-rose-300">{error}</p>
        )}

        {!state.claimedToday && (
          <Button
            type="button"
            onClick={claim}
            disabled={busy}
            className="mt-4 w-full"
          >
            {busy ? "Claiming…" : `Claim ${state.nextClaim?.rewardCoins ?? 0} coins`}
          </Button>
        )}

        {justClaimed && (
          <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            +{justClaimed.rewardCoins.toLocaleString("en-IN")} coins for
            day {justClaimed.dayNumber}
            {justClaimed.bonus && ` (${justClaimed.bonus.replace("_", " ")} bonus)`}.
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          30-day streak
        </h2>
        <ol className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
          {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => {
            const claimed = d <= currentDay;
            const upcoming =
              !state.claimedToday &&
              state.nextClaim != null &&
              d === state.nextClaim.dayNumber;
            const milestone = d === 7 || d === 14 || d === 30;
            return (
              <li
                key={d}
                title={
                  milestone
                    ? d === 7
                      ? "Day 7 — first-week bonus"
                      : d === 14
                        ? "Day 14 — earn a streak freeze"
                        : "Day 30 — loyalty bonus"
                    : `Day ${d}`
                }
                className={`relative grid aspect-square place-items-center rounded text-xs font-semibold transition ${
                  upcoming
                    ? "bg-amber-400/20 text-amber-200 ring-1 ring-amber-300"
                    : claimed
                      ? "bg-cyan-500/10 text-cyan-200"
                      : "bg-slate-900/60 text-slate-500"
                }`}
              >
                {d}
                {milestone && (
                  <span
                    className="absolute -top-1 -right-1 text-[8px] text-amber-300"
                    aria-hidden
                  >
                    ★
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[11px] text-slate-500">
          Milestones (★): day 7 first-week bonus, day 14 earns a streak
          freeze (max 3), day 30 loyalty bonus. After day 30 the streak
          loops back to day 1 and you keep the loyalty marker.
        </p>
      </Card>
    </div>
  );
}

function humaniseDuration(ms: number): string {
  if (ms <= 0) return "moments";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}
