import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WithdrawForm } from "@/components/WithdrawForm";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
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
    path: "/wallet/withdraw",
    title: t("meta.withdrawTitle", locale),
    description: t("meta.withdrawDescription", locale),
    noindex: true,
  });
}

/**
 * Withdrawal request page. Two halves: the form (UPI or bank), and the
 * history list (every withdrawal the user has ever filed). The form is a
 * client component so the user-input validation and the cancel buttons
 * stay reactive.
 */
export default async function WithdrawPage({
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
        encodeURIComponent(localizedPath("/wallet/withdraw", locale)),
    );
  }

  const [wallet, me, history] = await Promise.all([
    db.wallet.findUnique({ where: { userId: u.id }, select: { balance: true } }),
    db.user.findUnique({
      where: { id: u.id },
      select: { username: true, emailVerified: true, banned: true },
    }),
    db.withdrawalRequest.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  if (me?.banned) redirect(lp("/wallet"));

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Link
          href={lp("/wallet")}
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          {tr("withdraw.backToWallet")}
        </Link>
        <h1 className="text-2xl font-black">{tr("withdraw.heading")}</h1>
        <p className="text-sm text-slate-400">
          {tr("withdraw.subtext", { amount: fmtCoins(MIN_WITHDRAW_COINS) })}
        </p>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("withdraw.submitRequest")}</CardTitle>
            <span className="font-mono text-xs text-slate-400">
              {tr("withdraw.available", {
                amount: fmtCoins(wallet?.balance ?? 0),
              })}
            </span>
          </CardHeader>

          {!me?.emailVerified ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              {tr("withdraw.verifyEmail")}{" "}
              <Link
                href={lp("/profile")}
                className="underline hover:text-amber-100"
              >
                {tr("profile.heading")}
              </Link>
            </p>
          ) : (
            <WithdrawForm
              available={wallet?.balance ?? 0}
              min={MIN_WITHDRAW_COINS}
            />
          )}

          <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-[11px] text-slate-400">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span>{tr("withdraw.coinLocked")}</span>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("withdraw.yourWithdrawals")}</CardTitle>
            <span className="text-xs text-slate-500">{history.length}</span>
          </CardHeader>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              {tr("withdraw.noWithdrawals")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {history.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        ₹{fmtCoins(w.amountCoins)}
                      </span>
                      <Badge
                        tone={
                          w.status === "PAID"
                            ? "yes"
                            : w.status === "REJECTED"
                              ? "no"
                              : w.status === "PENDING"
                                ? "warn"
                                : w.status === "APPROVED"
                                  ? "info"
                                  : "default"
                        }
                      >
                        {w.status}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {w.payoutMethod} · {timeAgo(w.createdAt)}
                      {w.decidedAt && ` · ${timeAgo(w.decidedAt)}`}
                    </div>
                    {w.decisionNote && (
                      <div className="text-[11px] italic text-slate-500">
                        “{w.decisionNote}”
                      </div>
                    )}
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
