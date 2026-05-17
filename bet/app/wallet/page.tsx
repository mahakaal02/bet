import { redirect } from "next/navigation";
import Link from "next/link";
import { Coins, Sparkles, ShieldCheck, ArrowDownToLine } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuyCoinsGrid } from "@/components/BuyCoinsGrid";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { COIN_PACKS } from "@/lib/coin-packs";
import { MIN_WITHDRAW_COINS } from "@/lib/coins";
import { fmtCoins, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Wallet page. Hub for everything balance-related — view current balance,
 * buy coin packs, see recent top-ups + spends. Coin packs are server-
 * rendered so the prices are trustable; the buy action posts to /api/wallet
 * /topup which is the only path that credits the wallet.
 */
export default async function WalletPage() {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/wallet");

  const [wallet, recent, me, pendingWithdrawals] = await Promise.all([
    db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } }),
    db.transaction.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.user.findUnique({
      where: { id: u.id },
      select: { username: true, email: true, emailVerified: true },
    }),
    db.withdrawalRequest.findMany({
      where: { userId: u.id, status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Coins className="h-6 w-6 text-cyan-300" />
            Wallet
          </h1>
          <p className="text-sm text-slate-400">
            One balance across markets, auctions and Aviator.
          </p>
        </div>

        <Card className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                Current balance
              </div>
              <div className="flex items-center gap-2 text-4xl font-black text-cyan-300">
                {fmtCoins(wallet?.balance ?? 0)}
                <span className="text-base font-semibold text-slate-500">
                  coins
                </span>
              </div>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-1 text-xs text-slate-400">
              <Badge tone="info">
                <Sparkles className="h-3 w-3" /> Unified
              </Badge>
              <span>Same wallet across all Kalki Bet games.</span>
            </div>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Buy coins</CardTitle>
            <span className="text-xs text-slate-500">1 coin = ₹1</span>
          </CardHeader>
          <BuyCoinsGrid
            packs={COIN_PACKS}
            user={{ username: me?.username ?? "", email: me?.email ?? "" }}
          />
          <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-[11px] text-slate-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span>
              Payments are processed by Razorpay. Coins land in your wallet
              the moment Razorpay confirms the payment — the server cross-
              checks the signature so a tampered client can&apos;t fake a
              top-up. One balance across Markets, Auctions and Aviator.
            </span>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Withdraw</CardTitle>
            <span className="text-xs text-slate-500">
              min {fmtCoins(MIN_WITHDRAW_COINS)} coins
            </span>
          </CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              Cash out coins to your UPI or bank account. Each request
              goes to an admin for review before payout.
            </div>
            <Link
              href="/wallet/withdraw"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
            >
              <ArrowDownToLine className="h-4 w-4" />
              Request withdrawal
            </Link>
          </div>

          {!me?.emailVerified && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              Verify your email before requesting a withdrawal. Open the
              <Link
                href="/profile"
                className="ml-1 underline hover:text-amber-100"
              >
                profile page
              </Link>{" "}
              and click "Send link".
            </div>
          )}

          {pendingWithdrawals.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                In review
              </div>
              {pendingWithdrawals.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-mono">
                      ₹{fmtCoins(w.amountCoins)}{" "}
                      <Badge tone={w.status === "PENDING" ? "warn" : "info"}>
                        {w.status}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {w.payoutMethod} · {timeAgo(w.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link
              href="/profile"
              className="text-xs text-cyan-300 hover:text-cyan-200"
            >
              Full ledger →
            </Link>
          </CardHeader>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No activity yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {recent.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="text-slate-300">{prettyKind(t.kind)}</div>
                    <div className="text-[10px] text-slate-500">
                      {timeAgo(t.createdAt)}
                    </div>
                  </div>
                  <div
                    className={`font-mono ${
                      t.delta >= 0 ? "ticker-up" : "ticker-down"
                    }`}
                  >
                    {t.delta >= 0 ? "+" : ""}
                    {fmtCoins(t.delta)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}

function prettyKind(kind: string): string {
  switch (kind) {
    case "signup_bonus":
      return "Signup bonus";
    case "daily_claim":
      return "Daily reward";
    case "trade_buy":
      return "Bought shares";
    case "smart_buy_book":
      return "Bought shares · book leg";
    case "smart_buy_amm":
      return "Bought shares · AMM leg";
    case "smart_sell_book":
      return "Sold shares · book leg";
    case "smart_sell_amm":
      return "Sold shares · AMM leg";
    case "order_buy_fill":
      return "Limit order filled";
    case "order_sell_fill":
      return "Sell order filled";
    case "resolution_payout":
      return "Market payout";
    case "resolution_refund":
      return "Market cancelled — refunded";
    case "admin_grant":
      return "Admin grant";
    case "referral_bonus":
      return "Referral bonus";
    case "achievement_reward":
      return "Achievement reward";
    case "wallet_topup":
      return "Wallet top-up";
    default:
      return kind;
  }
}
