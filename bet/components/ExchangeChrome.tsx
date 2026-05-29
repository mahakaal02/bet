import Link from "next/link";
import { getAuthedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";
import { hubHomeUrl } from "@/lib/hub";
import { localizedPath, t, type Locale } from "@/lib/i18n";
import { ThemeSwitch } from "@/app/[locale]/wallet/wallet-client";

/**
 * Shared Markets-v2 chrome (topbar + footer) for the account/detail
 * surfaces that aren't already on the v2 grid pages. Mirrors the inline
 * topbar that markets/events/wallet/portfolio/watchlist render, so every
 * page shares one brand mark, nav, balance pill, theme switch and footer.
 *
 * `ExchangeTopbar` is a server component: it resolves the signed-in user
 * + wallet balance itself, so call sites just pass the active nav key and
 * the locale. The only client island is the shared `ThemeSwitch`.
 */
export type ExchangeNavKey =
  | "markets"
  | "events"
  | "portfolio"
  | "watchlist"
  | "wallet";

export async function ExchangeTopbar({
  active,
  locale,
}: {
  active?: ExchangeNavKey;
  locale: Locale;
}) {
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  const [wallet, me] = await Promise.all([
    u
      ? db.wallet.findUnique({
          where: { userId: u.id },
          select: { balance: true },
        })
      : Promise.resolve(null),
    u
      ? db.user.findUnique({
          where: { id: u.id },
          select: { username: true },
        })
      : Promise.resolve(null),
  ]);

  const username = me?.username ?? null;
  const initial = (username ?? "?").slice(0, 1).toUpperCase();
  const balance = wallet?.balance ?? 0;
  const navCls = (k: ExchangeNavKey) => (active === k ? "active" : undefined);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={hubHomeUrl()} aria-label="Kalki Exchange">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-mark"
            src="/kalki-logo.png?v=2"
            alt="Kalki Exchange"
            width={34}
            height={34}
          />
        </a>

        <nav className="nav" aria-label="primary">
          <Link className={navCls("markets")} href={lp("/markets")}>
            {tr("nav.markets")}
          </Link>
          <Link className={navCls("events")} href={lp("/events")}>
            {tr("nav.events")}
          </Link>
          <Link className={navCls("portfolio")} href={lp("/portfolio")}>
            {tr("nav.portfolio")}
          </Link>
          <Link className={navCls("watchlist")} href={lp("/watchlist")}>
            {tr("nav.watchlist")}
          </Link>
          <Link className={navCls("wallet")} href={lp("/wallet")}>
            {tr("nav.wallet")}
          </Link>
        </nav>

        <div className="topbar-right">
          {u ? (
            <>
              <span className="balance-pill">
                <span className="lbl">BAL</span> {fmtCoins(balance)}
              </span>
              <ThemeSwitch />
              <Link className="deposit-btn" href={lp("/wallet")}>
                + {tr("wallet.buyCoins")}
              </Link>
              <Link className="avatar" href={lp("/profile")}>
                {initial}
              </Link>
            </>
          ) : (
            <>
              <ThemeSwitch />
              <Link className="deposit-btn" href={lp("/wallet")}>
                {tr("nav.signIn")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function ExchangeFooter({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>{tr("market.footerBrand")}</span>
        <span>{tr("market.footerCompliance")}</span>
        <span>
          {tr("wallet.needHelp")}{" "}
          <Link href={lp("/profile")}>{tr("profile.heading")}</Link>
        </span>
      </div>
    </footer>
  );
}

/** Shared background stack — fixed mesh/grid/grain behind every v2 page. */
export function ExchangeBackdrop() {
  return (
    <div className="bg-stack" aria-hidden="true">
      <div className="bg-mesh" />
      <div className="bg-grid" />
      <div className="bg-grain" />
    </div>
  );
}
