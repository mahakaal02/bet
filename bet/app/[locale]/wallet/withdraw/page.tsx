import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import "../wallet-v2.css";
import { ThemeSwitch } from "../wallet-client";
import { WithdrawForm } from "@/components/WithdrawForm";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { MIN_WITHDRAW_COINS, WITHDRAW_EMAIL_VERIFY_THRESHOLD_COINS } from "@/lib/coins";
import { fetchLocalizedPricing, coinValueLabel } from "@/lib/pricing";
import { hubHomeUrl } from "@/lib/hub";
import { fmtCoins, timeAgo } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildAuthRedirect,
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
 * Withdrawal request page — re-skinned onto the Wallet v2 design system
 * (shared `.wlt` chrome + `.card` family) so it sits in harmony with the
 * wallet hub it links back to. Two halves: the form (UPI / bank / crypto)
 * and the history list of every withdrawal the user has filed. The form
 * is a client island so input validation + cancel buttons stay reactive.
 */
export default async function WithdrawPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  if (!u) {
    // Preserve UTM/click-IDs through the auth round-trip.
    const sp = await searchParams;
    redirect(buildAuthRedirect("/wallet/withdraw", sp, locale));
  }

  const [wallet, me, history, localized] = await Promise.all([
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
    fetchLocalizedPricing(locale),
  ]);

  if (me?.banned) redirect(lp("/wallet"));

  const balance = wallet?.balance ?? 0;
  // Estimated local-currency value of the balance (1000-pack anchor).
  const estValue = coinValueLabel(balance, localized);
  const currencyCode = localized?.currency ?? null;
  const username = me?.username ?? "user";
  const initial = username.slice(0, 1).toUpperCase();

  return (
    <div className="wlt">
      <div className="bg-stack" aria-hidden="true">
        <div className="bg-mesh" />
        <div className="bg-grid" />
        <div className="bg-grain" />
      </div>

      {/* ── TOPBAR ── */}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={hubHomeUrl()} aria-label="Kalki Exchange">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/kalki-logo.png?v=2" alt="Kalki Exchange" width={34} height={34} />
          </a>

          <nav className="nav" aria-label="primary">
            <Link href={lp("/markets")}>{tr("nav.markets")}</Link>
            <Link href={lp("/events")}>{tr("nav.events")}</Link>
            <Link href={lp("/portfolio")}>{tr("nav.portfolio")}</Link>
            <Link href={lp("/watchlist")}>{tr("nav.watchlist")}</Link>
            <Link className="active" href={lp("/wallet")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="14" rx="3" />
                <path d="M2 10h20" />
                <circle cx="17" cy="15" r="1.5" fill="currentColor" />
              </svg>
              {tr("nav.wallet")}
            </Link>
          </nav>

          <div className="topbar-right">
            <span className="balance-pill">
              <span className="lbl">BAL</span> {fmtCoins(balance)}
            </span>
            <ThemeSwitch />
            <Link className="deposit-btn" href={lp("/wallet")}>
              + {tr("wallet.buyCoins")}
            </Link>
            <div className="avatar">{initial}</div>
          </div>
        </div>
      </header>

      {/* ── STATUS STRIP ── */}
      <div className="status-strip">
        <div className="status-inner">
          <span className="live">{tr("wallet.unified").toUpperCase()}</span>
          {currencyCode && (
            <>
              <span className="sep">·</span>
              <span>{localized?.country} · {currencyCode}</span>
            </>
          )}
          <span className="sep">·</span>
          <span>{tr("wallet.statusMethods")}</span>
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        <div className="wd-wrap">
          <div className="page-head" style={{ marginBottom: 18 }}>
            <div>
              <Link className="wd-back" href={lp("/wallet")} style={{ marginBottom: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                {tr("withdraw.backToWallet")}
              </Link>
              <div className="crumbs">
                <span>{tr("wallet.crumbAccount")}</span>
                <span className="sep">/</span>
                <span className="here">{tr("withdraw.heading")}</span>
              </div>
              <h1 className="page-title">
                <em>{tr("withdraw.heading")}</em>
              </h1>
              <p className="page-sub">
                {tr("withdraw.subtext", { amount: fmtCoins(MIN_WITHDRAW_COINS) })}
              </p>
              {estValue && (
                <p className="wd-est">
                  {tr("withdraw.estValue", {
                    coins: fmtCoins(balance),
                    value: estValue,
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="wd-stack">
            {/* ── SUBMIT REQUEST ── */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("wallet.stepCashout")}</div>
                  <div className="card-title">{tr("withdraw.submitRequest")}</div>
                </div>
                <span className="row-time" style={{ fontSize: 11 }}>
                  {tr("withdraw.available", { amount: fmtCoins(balance) })}
                </span>
              </div>

              {!me?.emailVerified && (
                <p className="wd-warn">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    {tr("withdraw.emailThresholdNote", {
                      amount: fmtCoins(WITHDRAW_EMAIL_VERIFY_THRESHOLD_COINS),
                    })}{" "}
                    <Link href={lp("/profile")}>{tr("profile.heading")}</Link>
                  </span>
                </p>
              )}

              <div className="card-body" style={{ paddingTop: 0 }}>
                <WithdrawForm available={balance} min={MIN_WITHDRAW_COINS} />
              </div>

              <div className="withdraw-note wd-secure">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>{tr("withdraw.coinLocked")}</span>
              </div>
            </section>

            {/* ── HISTORY ── */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("wallet.stepLedger")}</div>
                  <div className="card-title">{tr("withdraw.yourWithdrawals")}</div>
                </div>
                <span className="row-time" style={{ fontSize: 11 }}>
                  {history.length}
                </span>
              </div>

              {history.length === 0 ? (
                <div className="wd-empty">{tr("withdraw.noWithdrawals")}</div>
              ) : (
                <div className="wd-list">
                  {history.map((w) => (
                    <div className="wd-item" key={w.id}>
                      <div style={{ minWidth: 0 }}>
                        <span className="wd-amt">
                          {fmtCoins(w.amountCoins)} {tr("wallet.coins")}
                        </span>
                        <div className="wd-meta">
                          {w.payoutMethod} · {timeAgo(w.createdAt)}
                          {w.decidedAt && ` · ${timeAgo(w.decidedAt)}`}
                        </div>
                        {w.decisionNote && (
                          <div className="wd-quote">“{w.decisionNote}”</div>
                        )}
                      </div>
                      <span className={`wd-status ${statusClass(w.status)}`}>
                        {w.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{tr("wallet.footerBrand")}</span>
          <span>
            {currencyCode
              ? `${localized?.country} · ${currencyCode}`
              : tr("wallet.unified")}
          </span>
          <span>
            {tr("wallet.needHelp")}{" "}
            <Link href={lp("/profile")}>{tr("profile.heading")}</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case "PAID":
      return "paid";
    case "REJECTED":
      return "rejected";
    case "PENDING":
      return "pending";
    case "APPROVED":
      return "approved";
    default:
      return "";
  }
}
