import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { ReferralsClient } from "./ReferralsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refer friends · Kalki" };

export interface ReferralSummary {
  code: string;
  counts: {
    PENDING: number;
    QUALIFIED: number;
    PAID: number;
    VOIDED: number;
  };
  totalCoinsEarned: number;
  rewardCoins: number;
}

/**
 * Refer-a-friend landing page. Shows the user's referral code +
 * share helpers + a tally of how many of their referrals have paid
 * out so far. The "claim a code" path is mostly for users who
 * signed up before referrals shipped (or via a flow that didn't
 * collect the code) — the standard signup form will accept the
 * code natively once the auth-side wiring lands.
 */
export default async function ReferralsPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/referrals");

  let summary: ReferralSummary;
  try {
    summary = await backend.authed(token).get<ReferralSummary>("/me/referrals");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/referrals");
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
          ← Account
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">Refer a friend</h1>
        <p className="mb-6 text-sm text-slate-400">
          Share your code. When they verify their identity and top up
          {" "}<span className="text-amber-300">{summary.rewardCoins} coins</span>{" "}
          land in your wallet (and they get a smaller bonus too).
        </p>

        <ReferralsClient initial={summary} />
      </div>
    </main>
  );
}
