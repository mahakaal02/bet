import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/Badge";
import { GroupMarketList } from "@/components/GroupMarketList";
import type { GroupChildView } from "@/components/GroupMarketRow";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  formatCategory,
  isLocale,
  marketTranslationInclude,
  resolveMarketContent,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const g = await db.marketGroup.findUnique({
    where: { slug },
    select: { title: true, description: true },
  });
  if (!g) {
    return buildLocalizedMetadata({
      locale,
      path: `/events/${slug}`,
      title: t("group.notFound", locale),
      description: t("errors.notFoundDescription", locale),
      noindex: true,
    });
  }
  const teaser = (g.description ?? "").split("\n")[0].slice(0, 180);
  return buildLocalizedMetadata({
    locale,
    path: `/events/${slug}`,
    title: g.title,
    description: teaser || g.title,
    ogType: "article",
  });
}

/**
 * Event (grouped-markets) page. An aggregating index over a set of child
 * binary markets — header + a live ranked candidate list. Trading happens on
 * the child markets' own detail pages (each row links there); this page never
 * mutates markets.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) => t(k, locale, vars);

  const group = await db.marketGroup.findUnique({
    where: { slug },
    include: {
      markets: {
        orderBy: { groupSortOrder: "asc" },
        include: marketTranslationInclude(locale),
      },
    },
  });
  if (!group) notFound();

  const exclusive = group.type === "EXCLUSIVE";
  const groupResolved = group.status === "RESOLVED" || group.status === "CANCELLED";

  const items: GroupChildView[] = group.markets.map((m) => {
    // Resolved children clamp to 1/0 so the bar reflects the outcome.
    const yes =
      m.status === "RESOLVED"
        ? m.resolvedAs === "YES"
          ? 1
          : m.resolvedAs === "NO"
            ? 0
            : priceYes({ yesShares: m.yesShares, noShares: m.noShares })
        : priceYes({ yesShares: m.yesShares, noShares: m.noShares });
    return {
      id: m.id,
      slug: m.slug,
      title: resolveMarketContent(m, locale).title,
      status: m.status,
      resolvedAs: m.resolvedAs,
      yesPrice: yes,
      volumeCoins: m.volumeCoins,
    };
  });

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge>{formatCategory(group.category, locale)}</Badge>
          {groupResolved && (
            <Badge tone={group.status === "CANCELLED" ? "warn" : "info"}>
              {group.status === "CANCELLED" ? tr("market.cancelled") : tr("market.resolved")}
            </Badge>
          )}
        </div>
        <h1 className="text-2xl font-black md:text-3xl">{group.title}</h1>
        {group.description && (
          <p className="mt-3 max-w-prose text-sm text-slate-300">{group.description}</p>
        )}
        <p className="mb-4 mt-2 text-sm text-slate-400">
          {tr("group.candidateCount", {
            count: items.length,
            s: items.length === 1 ? "" : "s",
          })}
        </p>

        <GroupMarketList items={items} exclusive={exclusive} />
      </div>
    </main>
  );
}
