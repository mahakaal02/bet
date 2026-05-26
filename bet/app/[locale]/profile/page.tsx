import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AchievementsGrid } from "@/components/AchievementsGrid";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { AvatarUploader } from "@/components/AvatarUploader";
import { SignOutCard } from "@/components/SignOutCard";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, levelFromXp } from "@/lib/utils";
import { Coins, Flame, Share2, Trophy } from "lucide-react";
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

  // Profile is the canonical account hub — identity, wallet, achievements,
  // sign-out. Watchlist + transaction history were dropped because they
  // duplicate dedicated surfaces (`/watchlist`, `/wallet`) and made this
  // page noisy. Their data still lives in the DB and is reachable from
  // those routes.
  const [user, wallet] = await Promise.all([
    db.user.findUnique({ where: { id: u.id } }),
    db.wallet.findUnique({ where: { userId: u.id } }),
  ]);
  if (!user) redirect(lp("/login"));

  const xp = levelFromXp(user.xp);

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        {!user.emailVerified && (
          <div className="mb-3">
            <VerifyEmailBanner email={user.email} />
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="md:col-span-2">
            <div className="flex items-center gap-4">
              <AvatarUploader image={user.image} name={user.username} size={56} />
              <div>
                <div className="text-xl font-black">{user.username}</div>
                <div className="text-xs text-slate-500">{user.email}</div>
                <div className="mt-1 flex items-center gap-1">
                  <Badge tone="info">
                    {tr("profile.levelBadge", { level: xp.level })}
                  </Badge>
                  {user.isAdmin && (
                    <Badge tone="warn">{tr("profile.adminBadge")}</Badge>
                  )}
                  {user.streak > 0 && (
                    <Badge tone="warn">
                      <Flame className="h-3 w-3" />
                      {tr("profile.streakBadge", { days: user.streak })}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{tr("profile.xpLabel", { xp: user.xp })}</span>
                <span>
                  {tr("profile.xpToNext", {
                    xp: xp.toNext,
                    level: xp.level + 1,
                  })}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500"
                  style={{ width: `${Math.round(xp.progress * 100)}%` }}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle className="mb-2">{tr("profile.wallet")}</CardTitle>
            <div className="flex items-center gap-2 text-3xl font-black text-cyan-300">
              <Coins className="h-7 w-7" />
              {fmtCoins(wallet?.balance ?? 0)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {tr("profile.walletCoins")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={lp("/wallet")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:opacity-95"
              >
                <Coins className="h-3.5 w-3.5" />
                {tr("profile.buyCoinButton")}
              </Link>
            </div>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("profile.referral")}</CardTitle>
            <Trophy className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <p className="text-sm text-slate-400">{tr("profile.referralSubtext")}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 font-mono text-sm">
              {user.referralCode ?? "—"}
            </code>
            <Share2 className="h-4 w-4 text-slate-500" />
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{tr("profile.achievements")}</CardTitle>
          </CardHeader>
          <AchievementsGrid />
        </Card>

        {/* Sign-out lives at the bottom of every profile surface across
            the three Kalki games. SignOutCard handles the cross-app
            chain so a single click clears all three sessions. */}
        <div className="mt-4">
          <SignOutCard />
        </div>
      </div>
    </main>
  );
}
