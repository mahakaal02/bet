import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { DailyLoginClient } from "./DailyLoginClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daily reward · Kalki Auctions" };

export interface DailyLoginState {
  streak: number;
  lastClaimAt: string | null;
  streakFreezes: number;
  claimedToday: boolean;
  nextClaim: {
    dayNumber: number;
    rewardCoins: number;
    bonus: string | null;
    freezeWouldBeSpent: boolean;
  } | null;
  nextClaimAt: string | null;
}

/**
 * Daily-login streak page. Server-renders the current state so the
 * first paint shows the right CTA (claim button or "come back at
 * <time>"). The claim itself is client-driven because we want the
 * optimistic-update / spinner UX.
 */
export default async function DailyLoginPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/daily");

  let state: DailyLoginState;
  try {
    state = await backend
      .authed(token)
      .get<DailyLoginState>("/me/daily-login");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/daily");
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Profile
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">Daily reward</h1>
        <p className="mb-6 text-sm text-slate-400">
          Sign in every day to keep the streak going. Bigger rewards on
          day 7, day 14, and day 30 — then it loops with the loyalty
          marker on for life.
        </p>
        <DailyLoginClient initial={state} />
      </div>
    </main>
  );
}
