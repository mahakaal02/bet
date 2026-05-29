import type { Metadata } from "next";
import { notFound } from "next/navigation";
// Reuse the approved Wallet v2 design system (fonts, palette, themes, glassy
// topbar, animated mesh background) so the event page is visually in harmony
// with the rest of the app rather than carrying its own bespoke chrome.
import "../../wallet/wallet-v2.css";
// The embedded trade panel (MarketTradePanel) is styled by the `.tradepanel`
// family that lives in markets-v2.css. Those rules are unscoped (not under
// `.mkt`) and the token block is identical to wallet-v2's, so importing it
// here only adds the panel styling without disturbing the event page theme.
import "../../markets/markets-v2.css";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { getAuthedUser } from "@/lib/auth";
import {
  EventDetailView,
  type EventCandidate,
  type EventTrade,
} from "@/components/EventDetailView";
import type { CommentRow } from "@/components/Comments";
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

/** Resample a child market's price history into exactly `n` evenly-spaced
 *  YES-probability points (0..100). Markets with too little history fall
 *  back to a flat line at the current price so the chart still renders a
 *  clean baseline instead of a single jagged dot. */
function sampleSeries(
  points: { yesPrice: number }[],
  current: number,
  n = 40,
): number[] {
  const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);
  if (points.length === 0) return Array.from({ length: n }, () => pct(current));
  if (points.length <= n) {
    const head = Array.from({ length: n - points.length }, () =>
      pct(points[0].yesPrice),
    );
    return [...head, ...points.map((p) => pct(p.yesPrice))];
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (points.length - 1));
    out.push(pct(points[idx].yesPrice));
  }
  return out;
}

/**
 * Event (grouped-markets) detail page — the aggregate view over a set of
 * child binary markets that belong to the same real-world event.
 *
 * Read-only with respect to the markets: it never mutates the AMM or places
 * orders. Trading happens on each child market's own detail page; the in-page
 * trade ticket is a quote/calculator that deep-links the user to the selected
 * candidate's market to actually place the order.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;

  const group = await db.marketGroup.findUnique({
    where: { slug },
    include: {
      markets: {
        orderBy: { groupSortOrder: "asc" },
        include: {
          ...marketTranslationInclude(locale),
          pricePoints: { orderBy: { recordedAt: "asc" }, take: 200 },
        },
      },
    },
  });
  if (!group) notFound();

  const ids = group.markets.map((m) => m.id);
  const me = await getAuthedUser();
  // Wallet balance for the topbar pill (mirrors the Wallet/Navbar chrome).
  const wallet = me
    ? await db.wallet.findUnique({
        where: { userId: me.id },
        select: { balance: true },
      })
    : null;

  const [tradersGroups, recentTrades, myPositions] = await Promise.all([
    ids.length
      ? db.trade.groupBy({ by: ["userId"], where: { marketId: { in: ids } } })
      : Promise.resolve([] as { userId: string }[]),
    ids.length
      ? db.trade.findMany({
          where: { marketId: { in: ids } },
          orderBy: { createdAt: "desc" },
          take: 15,
          include: {
            user: { select: { username: true } },
            market: { select: { title: true, slug: true } },
          },
        })
      : Promise.resolve([]),
    me && ids.length
      ? db.position.findMany({
          where: { userId: me.id, marketId: { in: ids } },
          select: { marketId: true, outcome: true, shares: true, costBasis: true },
        })
      : Promise.resolve(
          [] as {
            marketId: string;
            outcome: "YES" | "NO";
            shares: number;
            costBasis: number;
          }[],
        ),
  ]);

  // Group the signed-in user's positions by candidate market so the embedded
  // trade panel can show holdings and enable SELL for the right outcome.
  const positionsByMarket = new Map<
    string,
    { outcome: "YES" | "NO"; shares: number; costBasis: number }[]
  >();
  for (const p of myPositions) {
    const arr = positionsByMarket.get(p.marketId) ?? [];
    arr.push({ outcome: p.outcome, shares: p.shares, costBasis: p.costBasis });
    positionsByMarket.set(p.marketId, arr);
  }

  const exclusive = group.type === "EXCLUSIVE";
  const groupResolved =
    group.status === "RESOLVED" || group.status === "CANCELLED";

  const candidates: EventCandidate[] = group.markets.map((m) => {
    const rawYes = priceYes({ yesShares: m.yesShares, noShares: m.noShares });
    const yes =
      m.status === "RESOLVED"
        ? m.resolvedAs === "YES"
          ? 1
          : m.resolvedAs === "NO"
            ? 0
            : rawYes
        : rawYes;
    return {
      id: m.id,
      slug: m.slug,
      title: resolveMarketContent(m, locale).title,
      status: m.status,
      resolvedAs: m.resolvedAs,
      yesPrice: yes,
      volumeCoins: m.volumeCoins,
      liquidity: Math.round(m.yesShares + m.noShares),
      // Raw AMM reserves so the embedded MarketTradePanel can quote and trade
      // against this candidate's own pool (same as the standalone market page).
      yesShares: m.yesShares,
      noShares: m.noShares,
      positions: positionsByMarket.get(m.id) ?? [],
      series: sampleSeries(m.pricePoints, yes),
    };
  });

  const totalVolume = group.markets.reduce((s, m) => s + m.volumeCoins, 0);
  const totalLiquidity = group.markets.reduce(
    (s, m) => s + Math.round(m.yesShares + m.noShares),
    0,
  );

  // Latest child close date stands in for the event's resolution date.
  const resolvesAt =
    group.markets.reduce<number>(
      (max, m) => Math.max(max, new Date(m.endsAt).getTime()),
      0,
    ) || null;

  const trades: EventTrade[] = recentTrades.map((tr) => ({
    id: tr.id,
    username: tr.user.username,
    outcome: tr.outcome,
    cost: tr.cost,
    shares: tr.shares,
    marketTitle: tr.market.title,
    marketSlug: tr.market.slug,
    at: tr.createdAt.toISOString(),
  }));

  // Preload comment threads for every candidate so the Discussion tab paints
  // immediately (SWR fallbackData) — the event page holds many open SSE
  // streams that can otherwise starve the client-side comments fetch in dev.
  const commentRows = ids.length
    ? await db.comment.findMany({
        where: { marketId: { in: ids }, hidden: false },
        orderBy: { createdAt: "asc" },
        take: 1000,
        include: { user: { select: { username: true } } },
      })
    : [];

  const initialComments: Record<string, CommentRow[]> = {};
  {
    const repliesByParent = new Map<string, CommentRow[]>();
    const shape = (c: (typeof commentRows)[number]): CommentRow => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      likeCount: c.likeCount,
      parentId: c.parentId,
      user: { username: c.user.username },
    });
    for (const c of commentRows) {
      if (c.parentId) {
        const arr = repliesByParent.get(c.parentId) ?? [];
        arr.push(shape(c));
        repliesByParent.set(c.parentId, arr);
      }
    }
    for (const c of commentRows) {
      if (c.parentId) continue;
      const node: CommentRow = {
        ...shape(c),
        replies: repliesByParent.get(c.id) ?? [],
      };
      (initialComments[c.marketId] ??= []).push(node);
    }
    // Newest top-level comment first (replies stay oldest-first).
    for (const mid of Object.keys(initialComments)) {
      initialComments[mid].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      );
    }
  }

  return (
    <EventDetailView
      locale={locale}
      slug={slug}
      title={group.title}
      description={group.description}
      categoryLabel={formatCategory(group.category, locale)}
      exclusive={exclusive}
      resolved={groupResolved}
      status={group.status}
      candidates={candidates}
      trades={trades}
      totalVolume={totalVolume}
      totalLiquidity={totalLiquidity}
      tradersCount={tradersGroups.length}
      resolvesAt={resolvesAt}
      authed={!!me}
      balance={wallet?.balance ?? null}
      username={me?.username ?? null}
      initialComments={initialComments}
    />
  );
}
