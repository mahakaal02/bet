import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, timeAgo } from "@/lib/utils";
import { Star } from "lucide-react";
import { isLocale, localizedPath, t, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  return {
    title: t("watchlist.heading", locale),
    description: t("watchlist.heading", locale),
  };
}

export default async function WatchlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);

  const u = await getAuthedUser();
  if (!u) {
    redirect(
      localizedPath("/login", locale) +
        "?next=" +
        encodeURIComponent(localizedPath("/watchlist", locale)),
    );
  }

  const rows = await db.watchlist.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    include: { market: true },
  });

  // Empty-state copy uses an inline star icon. Split on the {icon}
  // placeholder so the icon renders inline as a React node rather
  // than a literal "{icon}" string.
  const emptyText = tr("watchlist.emptyState", { icon: "{icon}" });
  const [emptyBefore, emptyAfter = ""] = emptyText.split("{icon}");

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Star className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-black">{tr("watchlist.heading")}</h1>
          <span className="text-sm text-slate-500">· {rows.length}</span>
        </div>

        {rows.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-400">
              {emptyBefore}
              <Star className="inline h-3 w-3" />
              {emptyAfter}
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => {
              const m = row.market;
              const p = priceYes({
                yesShares: m.yesShares,
                noShares: m.noShares,
              });
              const resolved =
                m.status === "RESOLVED" || m.status === "CANCELLED";
              return (
                <Link key={row.id} href={lp(`/markets/${m.slug}`)}>
                  <Card className="fade-up h-full transition hover:border-cyan-500/30">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge>{m.category}</Badge>
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
                            : tr("market.resolvedOutcome", {
                                outcome: m.resolvedAs ?? "",
                              })}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {m.status === "OPEN"
                            ? tr("market.endsDate", {
                                date: new Date(m.endsAt).toLocaleDateString(
                                  locale,
                                ),
                              })
                            : tr("market.cancelled")}
                        </span>
                      )}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
                      {m.title}
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
                      <div className="text-right">
                        <div className="text-xs text-slate-500">
                          {tr("market.no")}
                        </div>
                        <div className="text-lg font-bold text-rose-300">
                          {fmtPrice(1 - p)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[10px] text-slate-500">
                      {timeAgo(row.createdAt)} ·{" "}
                      {tr("market.volume")} {fmtCoins(m.volumeCoins)}
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
