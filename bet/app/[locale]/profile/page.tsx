import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import "../markets/markets-v2.css";
import {
  ExchangeTopbar,
  ExchangeFooter,
  ExchangeBackdrop,
} from "@/components/ExchangeChrome";
import { AchievementsGrid } from "@/components/AchievementsGrid";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { AvatarUploader } from "@/components/AvatarUploader";
import { SignOutCard } from "@/components/SignOutCard";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, levelFromXp } from "@/lib/utils";
import { hubLoginUrl } from "@/lib/hub";
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
    path: "/profile",
    title: t("meta.profileTitle", locale),
    description: t("meta.profileDescription", locale),
    ogType: "profile",
    noindex: true,
  });
}

/**
 * Account hub — identity, XP, wallet, referral, achievements, sign-out.
 * Re-skinned onto the Markets v2 design system (shared topbar / bg-stack /
 * page-head / footer via ExchangeChrome) so it sits in harmony with the
 * rest of the exchange. The interactive islands (AvatarUploader,
 * AchievementsGrid, SignOutCard) are untouched client components.
 */
export default async function ProfilePage({
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
    const sp = await searchParams;
    redirect(buildAuthRedirect("/profile", sp, locale));
  }

  const [user, wallet] = await Promise.all([
    db.user.findUnique({ where: { id: u.id } }),
    db.wallet.findUnique({ where: { userId: u.id } }),
  ]);
  if (!user) redirect(hubLoginUrl());

  const xp = levelFromXp(user.xp);

  return (
    <div className="mkt">
      <ExchangeBackdrop />
      <ExchangeTopbar locale={locale} />

      <main className="page content">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("market.crumbTrade")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("profile.heading")}</span>
            </div>
            <h1 className="page-title">
              <em>{tr("profile.heading")}</em>
            </h1>
          </div>
        </div>

        <div className="stack narrow">
          {!user.emailVerified && <VerifyEmailBanner email={user.email} />}

          {/* Identity + XP */}
          <section className="panel accent">
            <div className="id-row">
              <AvatarUploader
                image={user.image}
                name={user.username}
                size={56}
              />
              <div style={{ minWidth: 0 }}>
                <div className="id-name">{user.username}</div>
                <div className="id-email">{user.email}</div>
                <div className="badges">
                  <span className="tag info">
                    {tr("profile.levelBadge", { level: xp.level })}
                  </span>
                  {user.isAdmin && (
                    <span className="tag warn">{tr("profile.adminBadge")}</span>
                  )}
                  {user.streak > 0 && (
                    <span className="tag warn">
                      {tr("profile.streakBadge", { days: user.streak })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="xp-meta">
                <span>{tr("profile.xpLabel", { xp: user.xp })}</span>
                <span>
                  {tr("profile.xpToNext", {
                    xp: xp.toNext,
                    level: xp.level + 1,
                  })}
                </span>
              </div>
              <div className="xpbar">
                <i style={{ width: `${Math.round(xp.progress * 100)}%` }} />
              </div>
            </div>
          </section>

          {/* Wallet */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">{tr("profile.wallet")}</div>
            </div>
            <div className="big-num">{fmtCoins(wallet?.balance ?? 0, locale)}</div>
            <p className="panel-sub" style={{ marginTop: 6 }}>
              {tr("profile.walletCoins")}
            </p>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" href={lp("/wallet")}>
                {tr("profile.buyCoinButton")}
              </Link>
            </div>
          </section>

          {/* Referral */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">{tr("profile.referral")}</div>
            </div>
            <p className="panel-sub">{tr("profile.referralSubtext")}</p>
            <div style={{ marginTop: 12 }}>
              <code className="code">{user.referralCode ?? "—"}</code>
            </div>
          </section>

          {/* Achievements */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">{tr("profile.achievements")}</div>
              <Link className="panel-meta" href={lp("/achievements")}>
                {tr("achievements.heading")} →
              </Link>
            </div>
            <AchievementsGrid />
          </section>

          {/* Sign out — cross-app chain handled by the client island. */}
          <SignOutCard />
        </div>
      </main>

      <ExchangeFooter locale={locale} />
    </div>
  );
}
