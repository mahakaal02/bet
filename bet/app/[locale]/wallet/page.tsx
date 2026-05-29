import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import "./wallet-v2.css";
import { BalanceHero, ThemeSwitch, SecureChatActions } from "./wallet-client";
import { BuyCoinsGrid } from "@/components/BuyCoinsGrid";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { COIN_PACKS } from "@/lib/coin-packs";
import { fetchLocalizedPricing, coinValueLabel } from "@/lib/pricing";
import { MIN_WITHDRAW_COINS } from "@/lib/coins";
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
    path: "/wallet",
    title: t("meta.walletTitle", locale),
    description: t("meta.walletDescription", locale),
    noindex: true,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wallet — Wallet v2 design (E:\kalki.bet-2\Wallet v2.html), wired to
 * the real backend. The page presentation changed wholesale; the data
 * flow is unchanged: auth gate, balance + PPP value, the BuyCoinsGrid
 * top-up path (/api/wallet/topup*), the withdraw page hand-off, and the
 * transaction ledger. No API routes or DB shapes were touched.
 */
export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) => t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  if (!u) {
    const sp = await searchParams;
    redirect(buildAuthRedirect("/wallet", sp, locale));
  }

  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [wallet, recent, me, pendingWithdrawals, localized, weekTxns, chatRow] =
    await Promise.all([
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
      fetchLocalizedPricing(locale),
      db.transaction.findMany({
        where: { userId: u.id, createdAt: { gte: weekAgo } },
        select: { delta: true, createdAt: true },
      }),
      db.adminSetting
        .findUnique({ where: { key: "wallet.chat_app_download_url" } })
        .catch(() => null),
    ]);

  const balance = wallet?.balance ?? 0;
  const localizedPacks = localized ? Array.from(localized.byCoins.values()) : [];
  const estValue = coinValueLabel(balance, localized);
  const currencyCode = localized?.currency ?? null;

  // 24h + 7d stats from the week window (all real ledger data).
  const dayAgoMs = Date.now() - DAY_MS;
  let last24h = 0;
  let net7d = 0;
  let vol7d = 0;
  for (const tx of weekTxns) {
    net7d += tx.delta;
    vol7d += Math.abs(tx.delta);
    if (new Date(tx.createdAt).getTime() >= dayAgoMs) last24h += tx.delta;
  }

  // Running balance for the ledger (balance AFTER each tx, newest first).
  let running = balance;
  const ledger = recent.map((tx) => {
    const after = running;
    running -= tx.delta;
    return { tx, after };
  });

  const chatAppUrl =
    chatRow?.value != null
      ? typeof chatRow.value === "string"
        ? chatRow.value
        : String(chatRow.value).replace(/^"|"$/g, "")
      : "";

  const emailVerified = !!me?.emailVerified;
  const username = me?.username ?? "user";
  const initial = username.slice(0, 1).toUpperCase();
  const syncedLabel = `SYNCED · ${fmtAbs(new Date(), locale)}`;

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
            <img className="brand-mark" src="/kalki-logo.png" alt="Kalki Exchange" width={34} height={34} />
          </a>

          <nav className="nav" aria-label="primary">
            <Link href={lp("/markets")}>{tr("nav.markets")}</Link>
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
              <span className="lbl">BAL</span> {fmtCoins(balance, locale)}
            </span>
            <ThemeSwitch />
            <a className="deposit-btn" href="#buy">+ {tr("wallet.buyCoins")}</a>
            <div className="avatar">{initial}</div>
          </div>
        </div>
      </header>

      {/* ── STATUS STRIP (honest, no fabricated figures) ── */}
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
          <span>{tr("wallet.statusGames")}</span>
          <span className="sep">·</span>
          <span>{tr("wallet.statusMethods")}</span>
        </div>
      </div>

      {/* ── PAGE ── */}
      <main className="page">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("wallet.crumbAccount")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("wallet.heading")}</span>
            </div>
            <h1 className="page-title">
              <em>{tr("wallet.title")}</em>
            </h1>
            <p className="page-sub">{tr("wallet.unifiedPromise")}</p>
          </div>
          <div className="crumbs" style={{ fontFamily: "var(--font-mono)" }}>
            <span>ACC · {username}</span>
            <span className="sep">·</span>
            <span style={{ color: emailVerified ? "var(--emerald-300)" : "var(--amber-300)" }}>
              {emailVerified ? tr("wallet.emailVerified") : tr("wallet.verifyEmail")}
            </span>
          </div>
        </div>

        <div className="grid">
          {/* ══════════ MAIN COLUMN ══════════ */}
          <div className="col-main">
            <BalanceHero
              balanceCoins={balance}
              valueLabel={estValue}
              currencyCode={currencyCode}
              last24h={last24h}
              syncedLabel={syncedLabel}
            />

            {/* BUY COINS — BuyCoinsGrid owns the card-head (it has the
                client-side "Custom amount" toggle). */}
            <section className="card" id="buy">
              <BuyCoinsGrid
                packs={COIN_PACKS}
                localizedPacks={localizedPacks}
                currencyCode={currencyCode}
                currencySymbol={localized?.symbol ?? null}
                locale={locale}
              />
            </section>

            {/* WITHDRAW */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("wallet.stepCashout")}</div>
                  <div className="card-title">{tr("withdraw.heading")}</div>
                </div>
                <span className="row-time" style={{ fontSize: "11px" }}>
                  {tr("wallet.inReview")}
                </span>
              </div>

              <div className="withdraw">
                <div className="left">
                  <div className="card-eyebrow">{tr("wallet.available")}</div>
                  <div className="withdraw-amount">
                    <span>{fmtCoins(balance, locale)}</span>
                    <span className="unit">{tr("wallet.coins")}</span>
                    {estValue && <span className="x">≈ {estValue}</span>}
                  </div>
                  <div className="withdraw-min">
                    {tr("withdraw.subtext", { amount: fmtCoins(MIN_WITHDRAW_COINS, locale) })}
                  </div>

                  <Link className="withdraw-cta" href={lp("/wallet/withdraw")} style={{ marginTop: "auto" }}>
                    {tr("withdraw.heading")}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>

                  <div className="withdraw-note" style={{ marginTop: "14px" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>{tr("withdraw.coinLocked")}</span>
                  </div>
                </div>

                <div className="right">
                  <div className="card-eyebrow">
                    {pendingWithdrawals.length > 0 ? tr("wallet.inReview") : tr("wallet.payoutMethods")}
                  </div>
                  <div className="withdraw-method-list">
                    {pendingWithdrawals.length > 0 ? (
                      pendingWithdrawals.map((w) => (
                        <div className="method" key={w.id}>
                          <div className="method-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="6" width="18" height="13" rx="2" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </div>
                          <div className="method-meta">
                            <div className="method-name">
                              {fmtCoins(w.amountCoins, locale)} {tr("wallet.coins")}
                            </div>
                            <div className="method-sub">
                              {w.payoutMethod} · {timeAgo(w.createdAt, locale)}
                            </div>
                          </div>
                          <div className={`method-time ${w.status === "PENDING" ? "warn" : ""}`}>
                            {w.status}
                          </div>
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="method">
                          <div className="method-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="6" width="18" height="13" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </div>
                          <div className="method-meta">
                            <div className="method-name">UPI</div>
                            <div className="method-sub">India</div>
                          </div>
                        </div>
                        <div className="method">
                          <div className="method-icon" style={{ background: "rgba(var(--logo-b-rgb),0.10)", borderColor: "rgba(var(--logo-b-rgb),0.25)", color: "#C7D2FE" }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 9l9-6 9 6" /><path d="M5 9v11h14V9" /><line x1="9" y1="14" x2="9" y2="18" /><line x1="15" y1="14" x2="15" y2="18" />
                            </svg>
                          </div>
                          <div className="method-meta">
                            <div className="method-name">{tr("withdrawForm.methodBank")}</div>
                            <div className="method-sub">SWIFT / IBAN</div>
                          </div>
                        </div>
                        <div className="method">
                          <div className="method-icon" style={{ background: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.25)", color: "var(--amber-300)" }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12 2 19 7 19 17 12 22 5 17 5 7 12 2" /><line x1="12" y1="2" x2="12" y2="22" />
                            </svg>
                          </div>
                          <div className="method-meta">
                            <div className="method-name">USDT</div>
                            <div className="method-sub" style={{ fontFamily: "var(--font-mono)" }}>TRC-20 / ERC-20</div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* RECENT ACTIVITY */}
            <section className="card ledger">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{tr("wallet.stepLedger")}</div>
                  <div className="card-title">{tr("wallet.recentActivity")}</div>
                </div>
                <Link className="small-link" href={lp("/profile")}>
                  {tr("wallet.fullLedger")}
                </Link>
              </div>

              {ledger.length === 0 ? (
                <div className="ledger-empty">{tr("wallet.noActivity")}</div>
              ) : (
                <div className="ledger-rows">
                  {ledger.map(({ tx, after }) => {
                    const meta = rowMeta(tx.kind, tx.delta);
                    return (
                      <div className="row" key={tx.id}>
                        <div className={`row-icon ${meta.icon}`}>{rowIcon(meta.icon)}</div>
                        <div className="row-desc">
                          <div className="label">{prettyKind(tx.kind, locale)}</div>
                          {meta.pill && (
                            <div className="sub">
                              <span className={`pill ${meta.pill.cls}`}>{tr(meta.pill.key)}</span>
                            </div>
                          )}
                        </div>
                        <div className="row-time">
                          {timeAgo(tx.createdAt, locale)}
                          <span className="abs">{fmtAbs(new Date(tx.createdAt), locale)}</span>
                        </div>
                        <div className="row-balance">
                          <span className="lbl">{tr("wallet.balanceLabel")}</span>
                          {fmtCoins(after, locale)}
                        </div>
                        <div className={`row-amt ${tx.delta >= 0 ? "pos" : "neg"}`}>
                          {tx.delta >= 0 ? "+" : "−"}
                          {fmtCoins(Math.abs(tx.delta), locale)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="ledger-foot">
                <span>{tr("wallet.coins")} · {ledger.length}</span>
                <Link className="small-link" href={lp("/profile")}>
                  {tr("wallet.fullLedger")}
                </Link>
              </div>
            </section>
          </div>

          {/* ══════════ SIDE RAIL ══════════ */}
          <aside className="col-side">
            <div className="summary">
              <div className="stat">
                <div className="lbl">{tr("wallet.stat7dNet")}</div>
                <div className={`v ${net7d > 0 ? "pos" : net7d < 0 ? "neg" : ""}`}>
                  {net7d >= 0 ? "+" : "−"}{fmtCoins(Math.abs(net7d), locale)}
                </div>
                <div className="delta">{tr("wallet.coins")}</div>
              </div>
              <div className="stat">
                <div className="lbl">{tr("wallet.stat7dVolume")}</div>
                <div className="v">{fmtCoins(vol7d, locale)}</div>
                <div className="delta">{weekTxns.length} {tr("wallet.txUnit")}</div>
              </div>
              <div className="stat">
                <div className="lbl">{tr("wallet.balanceLabel")}</div>
                <div className="v cy" style={{ color: "var(--cyan-200)" }}>{fmtCoins(balance, locale)}</div>
                <div className="delta">{tr("wallet.coins")}</div>
              </div>
              <div className="stat">
                <div className="lbl">{tr("wallet.inReview")}</div>
                <div className="v">{pendingWithdrawals.length}</div>
                <div className="delta">{tr("wallet.inReview")}</div>
              </div>
            </div>

            <div className="admin">
              <div className="icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3>{tr("wallet.chatTitle")}</h3>
              <p>{tr("wallet.chatBody")}</p>
              <SecureChatActions downloadUrl={chatAppUrl} />
            </div>

            <div className="compliance">
              <div className="row1">
                <span className="age">18+</span>
                <strong>{tr("wallet.complianceTitle")}</strong>
              </div>
              {tr("wallet.complianceBody")}
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>{tr("wallet.footerBrand")}</span>
          <span>{currencyCode ? `${localized?.country} · ${currencyCode}` : tr("wallet.unified")}</span>
          <span>
            {tr("wallet.needHelp")} <Link href={lp("/profile")}>{tr("profile.heading")}</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function fmtAbs(d: Date, locale: Locale): string {
  // Locale-aware month names, but pinned to 24-hour so the ledger keeps
  // its compact log-style timestamps regardless of locale defaults.
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .toUpperCase();
}

function rowMeta(
  kind: string,
  delta: number,
): { icon: "up" | "down" | "cyan" | "amber"; pill?: { key: string; cls: string } } {
  if (kind === "wallet_topup") return { icon: "cyan", pill: { key: "wallet.pillTopup", cls: "cyan" } };
  if (kind === "signup_bonus") return { icon: "amber", pill: { key: "wallet.pillBonus", cls: "amber" } };
  if (kind === "referral_bonus") return { icon: "amber", pill: { key: "wallet.pillReferral", cls: "amber" } };
  if (kind === "achievement_reward") return { icon: "amber", pill: { key: "wallet.pillReward", cls: "amber" } };
  if (kind === "daily_claim") return { icon: "amber", pill: { key: "wallet.pillDaily", cls: "amber" } };
  if (kind === "admin_grant") return { icon: "amber", pill: { key: "wallet.pillGrant", cls: "amber" } };
  if (
    kind.startsWith("trade") ||
    kind.startsWith("smart") ||
    kind.startsWith("order") ||
    kind.startsWith("resolution")
  ) {
    return { icon: delta >= 0 ? "up" : "down", pill: { key: "wallet.pillPredict", cls: "cyan" } };
  }
  return { icon: delta >= 0 ? "up" : "down" };
}

function rowIcon(kind: "up" | "down" | "cyan" | "amber") {
  if (kind === "up") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    );
  }
  if (kind === "down") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="5 12 12 19 19 12" />
      </svg>
    );
  }
  if (kind === "cyan") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="3" />
        <path d="M2 10h20" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
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
