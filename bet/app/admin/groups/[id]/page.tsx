import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { GroupForm } from "@/components/admin/GroupForm";
import { GroupResolvePanel } from "@/components/admin/GroupResolvePanel";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Single-event admin surface: edit metadata + see member markets. The
 * group-resolve action (Phase 2) mounts here once wired. Markets are attached
 * from the market side (each market's "Event / group" field), so this page
 * never mutates a market.
 */
export default async function AdminGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = await db.marketGroup.findUnique({
    where: { id },
    include: {
      markets: {
        orderBy: { groupSortOrder: "asc" },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          resolvedAs: true,
        },
      },
    },
  });
  if (!group) notFound();

  const isFinal = group.status === "RESOLVED" || group.status === "CANCELLED";
  const canResolve =
    group.type === "EXCLUSIVE" &&
    (group.status === "OPEN" || group.status === "CLOSED");
  const winnerMarket = group.resolvedWinnerMarketId
    ? group.markets.find((m) => m.id === group.resolvedWinnerMarketId)
    : null;

  return (
    <div className="max-w-3xl py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/admin/groups"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Events
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-black">{group.title}</h1>
        <Badge
          tone={
            group.status === "OPEN"
              ? "info"
              : group.status === "RESOLVED"
                ? "yes"
                : "warn"
          }
        >
          {group.status}
        </Badge>
        <span className="text-xs text-slate-500">{group.type}</span>
      </div>

      {canResolve && (
        <Card className="mt-2">
          <CardHeader>
            <CardTitle>
              {group.status === "CLOSED" ? "Post resolution" : "Resolve event"}
            </CardTitle>
          </CardHeader>
          <GroupResolvePanel
            groupId={group.id}
            markets={group.markets.map((m) => ({
              id: m.id,
              title: m.title,
              status: m.status,
            }))}
          />
        </Card>
      )}

      {group.type === "INDEPENDENT" && !isFinal && (
        <Card className="mt-2">
          <CardHeader>
            <CardTitle>Resolution</CardTitle>
          </CardHeader>
          <p className="text-sm text-slate-400">
            Independent events resolve per market — open each member market and
            post its outcome individually.
          </p>
        </Card>
      )}

      {isFinal && (
        <Card className="mt-2">
          <CardHeader>
            <CardTitle>
              {group.status === "CANCELLED" ? "Cancelled" : "Resolved"}
            </CardTitle>
          </CardHeader>
          <p className="text-sm text-slate-300">
            {group.status === "CANCELLED"
              ? "This event was cancelled and every market refunded its holders."
              : winnerMarket
                ? `Resolved — “${winnerMarket.title}” won.`
                : "This event is resolved."}
            {group.resolvedAt && ` ${group.resolvedAt.toLocaleString()}.`}
          </p>
          {group.resolutionNote && (
            <p className="mt-2 text-sm text-slate-400">{group.resolutionNote}</p>
          )}
        </Card>
      )}

      <Card className="mt-2">
        <CardHeader>
          <CardTitle>Edit details</CardTitle>
        </CardHeader>
        <GroupForm
          group={{
            id: group.id,
            title: group.title,
            description: group.description,
            category: group.category,
            type: group.type,
            status: group.status,
            featured: group.featured,
            sortOrder: group.sortOrder,
          }}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>
            Member markets ({group.markets.length})
          </CardTitle>
        </CardHeader>
        {group.markets.length === 0 ? (
          <p className="text-sm text-slate-400">
            No markets attached yet. Edit a market and choose this event under
            “Event / group”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {group.markets.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <Link
                  href={`/admin/markets/${m.id}`}
                  className="line-clamp-1 text-sm hover:text-slate-100"
                >
                  {m.title}
                </Link>
                <Badge
                  tone={
                    m.status === "OPEN"
                      ? "info"
                      : m.status === "RESOLVED"
                        ? m.resolvedAs === "YES"
                          ? "yes"
                          : "no"
                        : "warn"
                  }
                >
                  {m.status}
                  {m.status === "RESOLVED" && m.resolvedAs && ` · ${m.resolvedAs}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
