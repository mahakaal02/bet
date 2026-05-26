import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  formatCategory,
  formatResolvedAs,
  formatStatus,
  isLocale,
  listCategories,
  localizedPath,
  marketTranslationInclude,
  resolveMarketContent,
  t,
  type Locale,
  type MarketCategory,
} from "@/lib/i18n";
import Link from "next/link";
import { Search } from "lucide-react";

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
    path: "/markets",
    title: t("meta.marketsTitle", locale),
    description: t("meta.marketsDescription", locale),
  });
}

export default async function MarketsPage({
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

  const sp = await searchParams;
  const pickString = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  const q = pickString(sp.q).trim();
  const cat = (pickString(sp.cat) || "ALL").toUpperCase();
  const sort = pickString(sp.sort) || "trending";
  const status = (pickString(sp.status) || "OPEN").toUpperCase();

  // Drop "ALL" + every real category through the typed helper so the
  // filter-chip list and the validCat lookup stay in sync with the
  // Prisma enum. Adding a new MarketCategory in schema.prisma updates
  // both surfaces automatically.
  const categories = [
    { value: "ALL" as const, label: tr("market.categoryAll") },
    ...listCategories(locale),
  ];
  const validCat =
    categories.find((c) => c.value === cat)?.value ?? "ALL";

  // Side-load only the requested locale's translation row per market —
  // sidecar table keeps the join tiny (one row max per market).
  const markets = await db.market.findMany({
    where: {
      ...(status !== "ALL" && {
        status: status as "OPEN" | "RESOLVED" | "CLOSED" | "CANCELLED",
      }),
      ...(validCat !== "ALL" && { category: validCat as MarketCategory }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          {
            translations: {
              some: {
                locale,
                OR: [
                  { title: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      }),
    },
    include: marketTranslationInclude(locale),
    orderBy:
      sort === "volume"
        ? { volumeCoins: "desc" }
        : sort === "ending"
          ? { endsAt: "asc" }
          : sort === "new"
            ? { createdAt: "desc" }
            : { trendingScore: "desc" },
    take: 60,
  });

  // Status word for the "{count} {status} markets" caption. ALL falls
  // back to empty so the caption reads "5 markets" instead of "5 ALL
  // markets". Real enum values flow through the typed formatter.
  const statusLabel =
    status === "ALL"
      ? ""
      : formatStatus(
          status as "OPEN" | "RESOLVED" | "CLOSED" | "CANCELLED",
          locale,
        );

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-black">{tr("market.heading")}</h1>
          <p className="text-sm text-slate-400">
            {tr("market.marketCount", {
              count: markets.length,
              status: statusLabel,
              s: markets.length === 1 ? "" : "s",
            })}
          </p>
        </div>

        <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              name="q"
              defaultValue={q}
              placeholder={tr("market.searchPlaceholder")}
              className="ps-9"
            />
          </div>
          <select
            name="sort"
            defaultValue={sort}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          >
            <option value="trending">{tr("market.sortTrending")}</option>
            <option value="volume">{tr("market.sortVolume")}</option>
            <option value="ending">{tr("market.sortEnding")}</option>
            <option value="new">{tr("market.sortNewest")}</option>
          </select>
          <select
            name="status"
            defaultValue={status}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          >
            <option value="OPEN">{tr("market.filterOpen")}</option>
            <option value="RESOLVED">{tr("market.filterResolved")}</option>
            <option value="ALL">{tr("market.filterAll")}</option>
          </select>
          {validCat !== "ALL" && (
            <input type="hidden" name="cat" value={validCat} />
          )}
          <button
            type="submit"
            className="h-10 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            {tr("market.applyButton")}
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((c) => {
            const active = c.value === validCat;
            const href =
              c.value === "ALL"
                ? lp(
                    `/markets?q=${encodeURIComponent(q)}&sort=${sort}&status=${status}`,
                  )
                : lp(
                    `/markets?q=${encodeURIComponent(q)}&cat=${c.value}&sort=${sort}&status=${status}`,
                  );
            return (
              <Link
                key={c.value}
                href={href}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  active
                    ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-200"
                    : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>

        {markets.length === 0 ? (
          <Card>
            <div className="py-10 text-center text-sm text-slate-400">
              {tr("market.noMatches")}
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => {
              const p = priceYes({
                yesShares: m.yesShares,
                noShares: m.noShares,
              });
              const resolved =
                m.status === "RESOLVED" || m.status === "CANCELLED";
              // Localized title (falls back to the canonical authoring-
              // language title when no sidecar row exists for this locale).
              const localized = resolveMarketContent(m, locale);
              return (
                <Link key={m.id} href={lp(`/markets/${m.slug}`)}>
                  <Card className="fade-up h-full transition hover:border-cyan-500/30">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{formatCategory(m.category, locale)}</Badge>
                      {resolved ? (
                        <Badge
                          tone={
                            m.resolvedAs === "YES"
                              ? "yes"
                              : m.resolvedAs === "NO"
                                ? "no"
                                : "warn"
                          }
                        >
                          {m.status === "CANCELLED"
                            ? tr("market.cancelled")
                            : m.resolvedAs
                              ? formatResolvedAs(m.resolvedAs, locale)
                              : tr("market.resolved")}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {tr("market.endsDate", {
                            date: new Date(m.endsAt).toLocaleDateString(locale),
                          })}
                        </span>
                      )}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
                      {localized.title}
                    </h3>
                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500">
                          {tr("market.yes")}
                        </div>
                        <div className="text-lg font-bold text-emerald-300">
                          {fmtPrice(p)}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="text-xs text-slate-500">
                          {tr("market.no")}
                        </div>
                        <div className="text-lg font-bold text-rose-300">
                          {fmtPrice(1 - p)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[10px] text-slate-500">
                      {tr("market.vol")} {fmtCoins(m.volumeCoins)} ·{" "}
                      {fmtCoins(Math.round(m.yesShares + m.noShares))}{" "}
                      {tr("market.liq")}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
