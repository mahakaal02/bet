import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
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
    path: "/profile",
    title: t("meta.profileTitle", locale),
    description: t("meta.profileDescription", locale),
    noindex: true,
  });
}

interface Me {
  id: string;
  email: string | null;
  username: string;
  isAdmin: boolean;
  coinBalance: number;
}

/**
 * One profile, three games. This page is the single source for
 * account-level actions across the Kalki product suite:
 *
 *   - View identity + the unified wallet balance.
 *   - Cross-app sign-out: clears the auctions cookie, then chains
 *     through Bet's logout (clears the NextAuth cookie) and Aviator's
 *     /logout page (clears localStorage), and finally lands at /login.
 *
 * Why centralise here: all three apps share one user identity (the
 * auctions backend). Letting users sign out from N places lets them
 * accidentally end up signed-in to two products while signed-out from
 * a third. One button, one consistent end state.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (path: string) => localizedPath(path, locale);

  const token = await getSessionToken();
  if (!token) redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/profile"))}`);

  let me: Me;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
  } catch (err) {
    if (err instanceof BackendUnauthorized)
      redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/profile"))}`);
    throw err;
  }

  // Compact row helper — every middle section on this page renders the
  // same shape (section header → link to a deep page). Inlining the
  // markup 11 times would be ~250 LoC of noise. The locale-aware lp()
  // and the dictionary-driven title/subtext keep each section a single
  // line of intent.
  function SectionLink({
    section,
    href,
    title,
    subtext,
    danger = false,
  }: {
    section: string;
    href: string;
    title: string;
    subtext: string;
    danger?: boolean;
  }) {
    const hoverBorder = danger
      ? "hover:border-rose-500/40"
      : "hover:border-cyan-500/40";
    return (
      <Card className="mb-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {section}
        </h2>
        <Link
          href={href}
          className={`flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 ${hoverBorder} hover:bg-slate-800/80`}
        >
          <span>
            <span className="block font-medium">{title}</span>
            <span className="text-[11px] text-slate-500">{subtext}</span>
          </span>
          <span aria-hidden className="text-slate-500">
            →
          </span>
        </Link>
      </Card>
    );
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href={lp("/")}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          {tr("profile.backToHub")}
        </Link>

        <div className="mt-4 mb-6 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-slate-700 bg-slate-900/60 text-2xl font-black text-slate-100">
            {(me.username ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-100">
              @{me.username}
            </h1>
            <p className="text-sm text-slate-400">
              {me.email ?? tr("profile.noEmail")}
              {me.isAdmin && (
                <span className="ml-2 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  {tr("profile.adminBadge")}
                </span>
              )}
            </p>
          </div>
        </div>

        <Card className="mb-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {tr("profile.sectionAccount")}
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">
              {tr("profile.unifiedWallet")}
            </span>
            <span className="font-mono text-sm font-semibold text-amber-200">
              {tr("profile.coinsValue", {
                coins: me.coinBalance.toLocaleString("en-IN"),
              })}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            {tr("profile.unifiedNote")}
          </p>
        </Card>

        <SectionLink
          section={tr("profile.sectionProfile")}
          href={lp("/me/profile")}
          title={tr("profile.displayNameTitle")}
          subtext={tr("profile.displayNameSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionSecurity")}
          href={lp("/me/2fa")}
          title={tr("profile.twofaTitle")}
          subtext={tr("profile.twofaSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionRG")}
          href={lp("/me/rg")}
          title={tr("profile.rgTitle")}
          subtext={tr("profile.rgSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionDaily")}
          href={lp("/me/daily")}
          title={tr("profile.dailyTitle")}
          subtext={tr("profile.dailySubtext")}
        />
        <SectionLink
          section={tr("profile.sectionEmail")}
          href={lp("/me/email")}
          title={tr("profile.emailTitle")}
          subtext={tr("profile.emailSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionShipping")}
          href={lp("/me/addresses")}
          title={tr("profile.addressesTitle")}
          subtext={tr("profile.addressesSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionIdentity")}
          href={lp("/me/kyc")}
          title={tr("profile.kycTitle")}
          subtext={tr("profile.kycSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionReferrals")}
          href={lp("/me/referrals")}
          title={tr("profile.referralsTitle")}
          subtext={tr("profile.referralsSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionOrders")}
          href={lp("/me/orders")}
          title={tr("profile.ordersTitle")}
          subtext={tr("profile.ordersSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionHelp")}
          href={lp("/me/support")}
          title={tr("profile.supportTitle")}
          subtext={tr("profile.supportSubtext")}
        />
        <SectionLink
          section={tr("profile.sectionDanger")}
          href={lp("/me/delete")}
          title={tr("profile.deleteTitle")}
          subtext={tr("profile.deleteSubtext")}
          danger
        />

        <Card>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {tr("profile.sectionSignOut")}
          </h2>
          <p className="mb-3 text-sm text-slate-300">
            {tr("auth.signOutDescription")}
          </p>
          {/* Form posts to /api/auth/logout which clears the auctions
              cookie, then 303s through Bet's signout (clears NextAuth) and
              Aviator's logout page (clears localStorage), and finally
              redirects to /login. */}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20"
            >
              {tr("auth.signOutButton")}
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
