import Link from "next/link";
import type { MarketStatus, MarketCategory } from "@prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_FILTERS: { key: string; label: string; status?: MarketStatus }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open", status: "OPEN" },
  { key: "closed", label: "Closed", status: "CLOSED" },
  { key: "resolved", label: "Resolved", status: "RESOLVED" },
  { key: "cancelled", label: "Cancelled", status: "CANCELLED" },
];

/**
 * Dedicated market index for admins. Without this page, the only way to
 * navigate to a market post-resolution was through the 20-row "Recent
 * markets" table on /admin — anything older than that became unreachable
 * via the UI even though `/admin/markets/[id]` still worked by direct URL.
 *
 * Filterable by status (the common need: "show me everything that's CLOSED
 * and waiting for resolution"), paginated to keep the query bounded on big
 * accounts. Each row links to the per-market admin surface.
 */
export default async function AdminMarketsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const filter =
    STATUS_FILTERS.find((f) => f.key === sp.status) ?? STATUS_FILTERS[0];
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);

  const where = {
    ...(filter.status && { status: filter.status }),
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        { slug: { contains: q, mode: "insensitive" as const } },
      ],
    }),
  };

  const [total, markets] = await Promise.all([
    db.market.count({ where }),
    db.market.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { trades: true, positions: true, orders: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black">Markets</h1>
        <Link
          href="/admin/markets/new"
          className="rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-4 py-2 text-sm font-bold text-slate-950"
        >
          New market
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const params = new URLSearchParams();
          if (f.key !== "all") params.set("status", f.key);
          if (q) params.set("q", q);
          const href = `/admin/markets${params.toString() ? `?${params}` : ""}`;
          const active = f.key === filter.key;
          return (
            <Link
              key={f.key}
              href={href}
              className={
                "rounded-full border px-3 py-1 text-xs transition " +
                (active
                  ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-800 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200")
              }
            >
              {f.label}
            </Link>
          );
        })}
        <form className="ml-auto" action="/admin/markets" method="get">
          {filter.key !== "all" && (
            <input type="hidden" name="status" value={filter.key} />
          )}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search title or slug…"
            className="h-8 w-56 rounded-md border border-slate-700 bg-slate-900/60 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          />
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {total} {total === 1 ? "market" : "markets"}
            {filter.key !== "all" && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                · {filter.label}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2 pr-2">Title</th>
                <th className="py-2 pr-2">Cat</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Vol</th>
                <th className="py-2 pr-2">Trades</th>
                <th className="py-2 pr-2">Orders</th>
                <th className="py-2 pr-2">Ends</th>
                <th className="py-2 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {markets.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-slate-500">
                    No markets match this filter.
                  </td>
                </tr>
              )}
              {markets.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-2">
                    <Link
                      href={`/markets/${m.slug}`}
                      className="line-clamp-1 max-w-xs hover:text-slate-100"
                    >
                      {m.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-2">
                    <Badge>{m.category as MarketCategory}</Badge>
                  </td>
                  <td className="py-2 pr-2">
                    <Badge
                      tone={
                        m.status === "OPEN"
                          ? "info"
                          : m.status === "CLOSED"
                            ? "warn"
                            : m.status === "RESOLVED"
                              ? m.resolvedAs === "YES"
                                ? "yes"
                                : "no"
                              : m.status === "CANCELLED"
                                ? "warn"
                                : "default"
                      }
                    >
                      {m.status}
                      {m.status === "RESOLVED" && m.resolvedAs &&
                        ` · ${m.resolvedAs}`}
                    </Badge>
                  </td>
                  <td className="py-2 pr-2 font-mono">
                    {fmtCoins(m.volumeCoins)}
                  </td>
                  <td className="py-2 pr-2 font-mono">{m._count.trades}</td>
                  <td className="py-2 pr-2 font-mono">{m._count.orders}</td>
                  <td className="py-2 pr-2 text-xs text-slate-500">
                    {new Date(m.endsAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <Link
                      href={`/admin/markets/${m.id}`}
                      className="text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <PageLink
                page={page - 1}
                statusKey={filter.key}
                q={q}
                label="← Prev"
              />
            )}
            {page < pageCount && (
              <PageLink
                page={page + 1}
                statusKey={filter.key}
                q={q}
                label="Next →"
              />
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  page,
  statusKey,
  q,
  label,
}: {
  page: number;
  statusKey: string;
  q: string;
  label: string;
}) {
  const params = new URLSearchParams();
  if (statusKey !== "all") params.set("status", statusKey);
  if (q) params.set("q", q);
  if (page !== 1) params.set("page", String(page));
  const href = `/admin/markets${params.toString() ? `?${params}` : ""}`;
  return (
    <Link
      href={href}
      className="rounded-md border border-slate-800 px-3 py-1 hover:bg-slate-900/60 hover:text-slate-200"
    >
      {label}
    </Link>
  );
}
