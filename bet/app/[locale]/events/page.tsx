import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { GroupCard, type GroupCardData } from "@/components/GroupCard";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { groupDisplayPrices } from "@/lib/market-group";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  formatCategory,
  isLocale,
  localizedPath,
  marketTranslationInclude,
  resolveMarketContent,
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
    path: "/events",
    title: t("meta.eventsTitle", locale),
    description: t("meta.eventsDescription", locale),
  });
}

/**
 * Events index — a flat list of every grouped market ("event"), each collapsed
 * into one GroupCard (leader candidate + aggregate volume). Trading happens on
 * the child markets' detail pages, reached from an event page. Read-only; this
 * page never mutates a market or a group.
 */
export default async function EventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) => t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const groups = await db.marketGroup.findMany({
    include: { markets: { include: marketTranslationInclude(locale) } },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    take: 60,
  });

  const cards = groups.map((g) => {
    const exclusive = g.type === "EXCLUSIVE";
    const groupResolved = g.status === "RESOLVED" || g.status === "CANCELLED";
    const childPrices = g.markets.map((m) => ({
      marketId: m.id,
      yesPrice:
        m.status === "RESOLVED"
          ? m.resolvedAs === "YES"
            ? 1
            : m.resolvedAs === "NO"
              ? 0
              : priceYes({ yesShares: m.yesShares, noShares: m.noShares })
          : priceYes({ yesShares: m.yesShares, noShares: m.noShares }),
    }));
    const display = groupDisplayPrices(childPrices, exclusive);
    const pctById = new Map(display.map((d) => [d.marketId, d.normalizedPct]));
    const top = [...g.markets].sort(
      (a, b) => (pctById.get(b.id) ?? 0) - (pctById.get(a.id) ?? 0),
    )[0];
    const data: GroupCardData = {
      slug: g.slug,
      title: g.title,
      category: formatCategory(g.category, locale),
      childCount: g.markets.length,
      volumeCoins: g.markets.reduce((s, m) => s + m.volumeCoins, 0),
      leader: top
        ? { title: resolveMarketContent(top, locale).title, pct: (pctById.get(top.id) ?? 0) / 100 }
        : null,
      resolved: groupResolved,
      resolvedLabel: groupResolved
        ? g.status === "CANCELLED"
          ? tr("market.cancelled")
          : tr("market.resolved")
        : undefined,
    };
    return { id: g.id, data };
  });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-black">{tr("group.heading")}</h1>
          <p className="text-sm text-slate-400">
            {tr("group.eventCount", {
              count: cards.length,
              s: cards.length === 1 ? "" : "s",
            })}
          </p>
        </div>

        {cards.length === 0 ? (
          <Card>
            <div className="py-10 text-center text-sm text-slate-400">{tr("group.empty")}</div>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((g) => (
              <GroupCard
                key={g.id}
                href={lp(`/events/${g.data.slug}`)}
                data={g.data}
                labels={{
                  candidates: tr("group.candidates"),
                  chance: tr("group.chance"),
                  vol: tr("market.vol"),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
