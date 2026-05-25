import Link from "next/link";
import { db } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/admin/ui/primitives";
import { fmtCoins, fmtDate, fmtRelative } from "@/components/admin/ui/format";
import { IconScale } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Settlement queue (PR-BET-ADMIN-REDESIGN).
 *
 * Lists markets in CLOSED state (trading ended, not yet resolved)
 * plus a history strip of recently resolved markets. Each pending
 * row deep-links to the existing market-detail page where the
 * Resolve action lives.
 *
 * Also surfaces the new Settlement table when populated — that
 * table will start filling once the resolve endpoint writes audit
 * rows on success (follow-up).
 */
export default async function SettlementsPage() {
  const now = new Date();
  const [pending, recent, settlements] = await Promise.all([
    db.market.findMany({
      where: {
        OR: [
          { status: "CLOSED" },
          { status: "OPEN", endsAt: { lte: now } },
        ],
      },
      orderBy: { endsAt: "asc" },
      take: 50,
      include: {
        _count: { select: { trades: true, positions: true } },
      },
    }),
    db.market.findMany({
      where: { status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      take: 20,
      include: {
        _count: { select: { trades: true } },
      },
    }),
    db.settlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader
        kicker="Markets"
        title="Settlement queue"
        description="Markets whose trading window has ended and need an admin to declare the outcome."
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-4 py-3">
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
              Pending resolution
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">
              Closed markets awaiting an admin decision. Click any row to view the resolve flow.
            </div>
          </div>
          <Badge tone={pending.length > 0 ? "warning" : "neutral"} dot>
            {pending.length} pending
          </Badge>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Market</th>
              <th className="px-4 py-2 text-right">Volume</th>
              <th className="px-4 py-2 text-right">Positions</th>
              <th className="px-4 py-2 text-right">Closed</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {pending.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={<IconScale size={18} />}
                    title="Queue empty"
                    description="No markets currently awaiting resolution."
                  />
                </td>
              </tr>
            )}
            {pending.map((m) => (
              <tr key={m.id} className="text-[var(--admin-text-primary)] transition hover:bg-[var(--admin-elevated)]">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/markets/${m.id}`} className="block max-w-[34ch] truncate font-semibold hover:text-cyan-300">
                    {m.title}
                  </Link>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
                    {m.category}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {fmtCoins(Number(m.volumeCoins))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {m._count.positions}
                </td>
                <td className="px-4 py-2.5 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtRelative(m.endsAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/admin/markets/${m.id}`} className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">
                    Resolve →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Recently resolved + Settlement audit rows. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-4 py-3">
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
              Recently settled
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">
              Last 20 resolutions. Cross-referenced with audit rows when available.
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Market</th>
              <th className="px-4 py-2 text-left">Outcome</th>
              <th className="px-4 py-2 text-right">Trades</th>
              <th className="px-4 py-2 text-right">Resolved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-[var(--admin-text-muted)]">
                  No resolutions yet.
                </td>
              </tr>
            )}
            {recent.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/markets/${m.slug}`} className="block max-w-[34ch] truncate hover:text-cyan-300">
                    {m.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={m.resolvedAs === "YES" ? "success" : "danger"} dot>
                    {m.resolvedAs ?? "—"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{m._count.trades}</td>
                <td className="px-4 py-2.5 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(m.resolvedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {settlements.length > 0 && (
        <p className="mt-4 text-[11px] text-[var(--admin-text-muted)]">
          {settlements.length} settlement audit row{settlements.length === 1 ? "" : "s"}{" "}
          recorded. The resolve endpoint starts writing these once the
          follow-up integration ships.
        </p>
      )}
    </>
  );
}
