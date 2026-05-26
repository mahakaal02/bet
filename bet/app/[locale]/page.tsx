import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TokenBridge } from "@/components/TokenBridge";
import { Navbar } from "@/components/Navbar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ActivityTicker } from "@/components/ActivityTicker";
import { FeaturedCarousel } from "@/components/FeaturedCarousel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import {
  TrendingUp,
  Trophy,
  Coins,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

/**
 * Landing-page SEO metadata. Because this is the locale root (e.g.
 * `/en`, `/pt`), the title here is the bare site name — the layout's
 * title template won't double-wrap it the way it does on sub-pages.
 * Description sells the product in the user's language; OG + Twitter
 * pick up the same copy.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/",
    title: t("meta.homeTitle", locale),
    description: t("meta.homeDescription", locale),
  });
}

/**
 * Localized landing page (PR-BET-I18N).
 *
 * Same data shape as the (now-superseded) `app/page.tsx`; the only
 * change is every user-visible string runs through `t(key, locale)`
 * and every internal link uses `localizedPath(href, locale)` so
 * inter-page navigation stays inside the chosen locale tree.
 *
 * The pattern this page demonstrates — `const locale = await
 * params.locale; const text = (k) => t(k, locale)` — is what every
 * other page should adopt when migrating into `[locale]/`. See
 * `lib/i18n/README.md` for the step-by-step migration guide.
 */

export const dynamic = "force-dynamic";

export default async function LocalizedLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  // Tiny shorthand — page-level. Beats threading `locale` through
  // every nested `<Component>` prop.
  const tr = (key: string, vars?: Record<string, string | number>) =>
    t(key, locale, vars);
  const lp = (href: string) => localizedPath(href, locale);

  // Same parallel reads the (English) landing page does. Each query
  // is keyed on shared DB state that's identical across locales, so
  // there's no per-locale cache fragmentation.
  const [featured, trending, leaderboard, stats] = await Promise.all([
    db.market.findMany({
      where: { status: "OPEN", featured: true },
      orderBy: { trendingScore: "desc" },
      take: 8,
    }),
    db.market.findMany({
      where: { status: "OPEN" },
      orderBy: { trendingScore: "desc" },
      take: 6,
    }),
    db.user.findMany({
      orderBy: { xp: "desc" },
      take: 5,
      select: { id: true, username: true, image: true, xp: true, level: true },
    }),
    db.$transaction([
      db.market.count(),
      db.market.count({ where: { status: "OPEN" } }),
      db.trade.count(),
      db.user.count(),
    ]),
  ]);
  const [marketCount, openMarkets, tradeCount, userCount] = stats;

  return (
    <>
      <Suspense fallback={null}>
        <TokenBridge />
      </Suspense>
      <Navbar />

      {/* Hero — fully localized; CTAs link into the locale tree. */}
      <section className="mx-auto max-w-5xl px-4 pt-10 pb-12">
        <div className="flex items-start justify-between gap-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
            {tr("landing.heroKicker")}
          </p>
          {/* Header-mounted language switcher. Footer-mounted variant
              optional — having one in either spot is enough for SEO. */}
          <LanguageSwitcher currentLocale={locale} />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-slate-100 sm:text-5xl">
          {tr("landing.heroTitle")}
        </h1>
        <p className="mt-3 max-w-2xl text-base text-slate-400">
          {tr("landing.heroDescription")}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={lp("/markets")}>
            <Button size="lg">{tr("landing.ctaPrimary")}</Button>
          </Link>
          <Link href={lp("/wallet")}>
            <Button size="lg" variant="ghost">
              {tr("nav.wallet")}
            </Button>
          </Link>
        </div>

        {/* Stat strip. */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={tr("landing.statsMarkets")} value={fmtCoins(openMarkets)} />
          <Stat
            label={tr("landing.statsUsers")}
            value={fmtCoins(userCount)}
          />
          <Stat label={tr("landing.statsTrades")} value={fmtCoins(tradeCount)} />
          <Stat
            label={tr("nav.markets")}
            value={fmtCoins(marketCount)}
            sub={tr("market.resolved")}
          />
        </div>
      </section>

      {/* Featured carousel — content is market data (already locale-
          agnostic since markets are user-generated; titles stay in
          their authoring language. Future enhancement: per-market
          translation, but out of scope here). */}
      <section className="mx-auto max-w-5xl px-4 pb-12">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">
          {tr("landing.trendingHeader")}
        </h2>
        <FeaturedCarousel markets={featured} />
      </section>

      {/* Trending list. */}
      <section className="mx-auto max-w-5xl px-4 pb-12">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">
          {tr("landing.trendingHeader")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {trending.map((m) => {
            const yes = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
            return (
              <li key={m.id}>
                <Link
                  href={lp(`/markets/${m.slug}`)}
                  className="block rounded-xl border border-slate-800 bg-slate-900/40 p-3 transition hover:border-cyan-500/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-100">
                      {m.title}
                    </span>
                    <Badge tone="info">{fmtPrice(yes)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {tr("market.volume")} {fmtCoins(m.volumeCoins)} ·{" "}
                    {tr("market.ends")} {m.endsAt.toLocaleDateString(locale)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Leaderboard. */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">
          {tr("landing.leaderboardHeader")}
        </h2>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-800">
            {leaderboard.map((u, i) => (
              <li
                key={u.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="w-5 font-mono text-slate-500">{i + 1}</span>
                <span className="flex-1 font-semibold text-slate-100">
                  @{u.username}
                </span>
                <span className="font-mono text-slate-400">
                  Lv {u.level} · {fmtCoins(u.xp)} XP
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <ActivityTicker />
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-black tabular-nums text-slate-100">
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
