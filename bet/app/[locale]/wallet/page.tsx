import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/wallet",
    title: t("meta.walletTitle", locale),
    description: t("meta.walletDescription", locale),
    // Authenticated surface — serves user-specific balance data, so
    // it shouldn't be indexed. The robots.txt also disallows it, but
    // a per-page noindex meta is the belt-and-suspenders signal.
    noindex: true,
  });
}

/**
 * Wallet page. Hub for everything balance-related — view current balance,
 * buy coin packs, see recent top-ups + spends. Coin packs are server-
 * rendered so the prices are trustable; the buy action posts to /api/wallet
 * /topup which is the only path that credits the wallet.
 */
export default async function WalletPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  if (!u) {
    redirect(
      localizedPath("/login", locale) +
        "?next=" +
        encodeURIComponent(localizedPath("/wallet", locale)),
    );
  }

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
            {tr("wallet.heading")}
          </h1>
          <p className="text-sm text-slate-400">{tr("wallet.subtext")}</p>
        </div>

        <Card className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                {tr("wallet.currentBalance")}
              </div>
              <div className="flex items-center gap-2 text-4xl font-black text-cyan-300">
                {fmtCoins(wallet?.balance ?? 0)}
                <span className="text-base font-semibold text-slate-500">
                  {tr("wallet.coins")}
                </span>
              </div>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-1 text-xs text-slate-400">
              <Badge tone="info">
                <Sparkles className="h-3 w-3" /> {tr("wallet.unified")}
              </Badge>
              <span>{tr("wallet.unifiedNote")}</span>
            </div>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{tr("wallet.buyCoins")}</CardTitle>
            <span className="text-xs text-slate-500">{tr("wallet.coinRate")}</span>
          </CardHeader>
          <BuyCoinsGrid
            packs={COIN_PACKS}
            user={{ username: me?.username ?? "", email: me?.email ?? "" }}
            locale={locale}
          />
          {/* PR-BET-ADMIN-FOLLOWUPS — replaces the previous
              "Payments are processed by Razorpay…" disclosure block.
              Top-ups now route through the Secured Kalki Chat App; the
              call-to-action with the super-admin-controlled download
              link lives inside <BuyCoinsGrid> right under the pack
              tiles, so the user sees one consistent message rather
              than two redundant ones. The remaining copy here just
              clarifies the unified-wallet promise. */}
          <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-[11px] text-slate-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span>{tr("wallet.unifiedPromise")}</span>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{tr("wallet.withdraw")}</CardTitle>
            <span className="text-xs text-slate-500">
              {tr("wallet.minWithdraw", { amount: fmtCoins(MIN_WITHDRAW_COINS) })}
            </span>
          </CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">{tr("wallet.withdrawSubtext")}</div>
            <Link
              href={lp("/wallet/withdraw")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
            >
              <ArrowDownToLine className="h-4 w-4" />
              {tr("wallet.requestWithdrawal")}
            </Link>
          </div>

          {!me?.emailVerified && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              {tr("wallet.verifyEmailNote")}{" "}
              <Link
                href={lp("/profile")}
                className="ms-1 underline hover:text-amber-100"
              >
                {tr("profile.heading")}
              </Link>
            </div>
          )}

          {pendingWithdrawals.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {tr("wallet.inReview")}
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
            <CardTitle>{tr("wallet.recentActivity")}</CardTitle>
            <Link
              href={lp("/profile")}
              className="text-xs text-cyan-300 hover:text-cyan-200"
            >
              {tr("wallet.fullLedger")}
            </Link>
          </CardHeader>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {tr("wallet.noActivity")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {recent.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="text-slate-300">{prettyKind(tx.kind, locale)}</div>
                    <div className="text-[10px] text-slate-500">
                      {timeAgo(tx.createdAt)}
                    </div>
                  </div>
                  <div
                    className={`font-mono ${
                      tx.delta >= 0 ? "ticker-up" : "ticker-down"
                    }`}
                  >
                    {tx.delta >= 0 ? "+" : ""}
                    {fmtCoins(tx.delta)}
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

function prettyKind(kind: string, locale: Locale): string {
  switch (kind) {
    case "signup_bonus":
      return t("transaction.signupBonus", locale);
    case "daily_claim":
      return t("transaction.dailyReward", locale);
    case "trade_buy":
      return t("transaction.boughtShares", locale);
    case "smart_buy_book":
      return t("transaction.boughtSharesBook", locale);
    case "smart_buy_amm":
      return t("transaction.boughtSharesAmm", locale);
    case "smart_sell_book":
      return t("transaction.soldSharesBook", locale);
    case "smart_sell_amm":
      return t("transaction.soldSharesAmm", locale);
    case "order_buy_fill":
      return t("transaction.limitOrderFilled", locale);
    case "order_sell_fill":
      return t("transaction.sellOrderFilled", locale);
    case "resolution_payout":
      return t("transaction.marketPayout", locale);
    case "resolution_refund":
      return t("transaction.marketRefund", locale);
    case "admin_grant":
      return t("transaction.adminGrant", locale);
    case "referral_bonus":
      return t("transaction.referralBonus", locale);
    case "achievement_reward":
      return t("transaction.achievementReward", locale);
    case "wallet_topup":
      return t("transaction.topUp", locale);
    default:
      return kind;
  }
}
