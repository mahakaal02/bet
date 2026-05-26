import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { ResponsibleGamblingClient } from "./ResponsibleGamblingClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Responsible gambling · Kalki Auctions",
};

interface RgProfile {
  userId: string;
  dailyDepositLimitCoins: number | null;
  weeklyDepositLimitCoins: number | null;
  monthlyDepositLimitCoins: number | null;
  dailyLossLimitCoins: number | null;
  weeklyLossLimitCoins: number | null;
  monthlyLossLimitCoins: number | null;
  dailyWagerLimitCoins: number | null;
  sessionReminderMinutes: number;
  cooldownUntil: string | null;
  selfExcludedUntil: string | null;
  selfExcludedAt: string | null;
}

/**
 * Responsible-gambling settings. Server-rendered shell + client
 * component for the editable controls. We always render the
 * helpline number — regulators expect it on the limits page.
 */
export default async function ResponsibleGamblingPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/rg");

  let profile: RgProfile;
  try {
    profile = await backend.authed(token).get<RgProfile>("/me/rg-profile");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/rg");
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

        <h1 className="mt-3 mb-1 text-2xl font-black">Responsible gambling</h1>
        <p className="mb-6 text-sm text-slate-400">
          Set limits, schedule a break, or self-exclude. Lowering a
          limit takes effect immediately. Raising a limit is paused
          for 24 hours — contact support to schedule the change.
        </p>

        <Card className="mb-4 border-amber-500/30 bg-amber-500/5 text-xs text-amber-100">
          Need help right now? Call the National Helpline for Problem
          Gambling at <strong>1800-599-0019</strong> (toll-free, 24×7,
          India).
        </Card>

        <ResponsibleGamblingClient initialProfile={profile} />
      </div>
    </main>
  );
}
