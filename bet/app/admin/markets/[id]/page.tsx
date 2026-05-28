import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MarketForm } from "@/components/MarketForm";
import { ResolveMarketPanel } from "@/components/ResolveMarketPanel";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Overview tab for a single market admin surface. Layout owns the
 * header + tab strip; this page just renders the Resolve / Edit
 * panels.
 *
 * The Resolve panel renders for both OPEN and CLOSED markets — admins
 * usually post the outcome AFTER the market expires (`endsAt` past →
 * scheduler flips status to CLOSED), so gating on OPEN alone hides the
 * controls exactly when they're needed. The resolve route itself only
 * rejects RESOLVED / CANCELLED states.
 *
 * The Edit panel hides once a market is RESOLVED / CANCELLED — the
 * resolve route already gates re-edits server-side, the UI just mirrors.
 */
export default async function MarketOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const market = await db.market.findUnique({ where: { id } });
  if (!market) notFound();

  // Groups this market may be (re)assigned to. Include the market's current
  // group even if RESOLVED/CANCELLED so the current selection always renders.
  const groups = await db.marketGroup.findMany({
    where: {
      OR: [
        { status: { in: ["OPEN", "CLOSED"] } },
        ...(market.groupId ? [{ id: market.groupId }] : []),
      ],
    },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, title: true },
  });

  const canResolve = market.status === "OPEN" || market.status === "CLOSED";
  const isFinal = market.status === "RESOLVED" || market.status === "CANCELLED";

  return (
    <div className="max-w-3xl">
      {canResolve && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>
              {market.status === "CLOSED" ? "Post resolution" : "Resolve"}
            </CardTitle>
          </CardHeader>
          {market.status === "CLOSED" && (
            <p className="mb-3 text-xs text-slate-400">
              Trading on this market ended at{" "}
              {market.endsAt.toLocaleString()}. Post the outcome below to pay
              winning positions and close it out.
            </p>
          )}
          <ResolveMarketPanel marketId={market.id} />
        </Card>
      )}

      {market.status === "RESOLVED" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Resolved</CardTitle>
          </CardHeader>
          <p className="text-sm text-slate-300">
            Resolved as{" "}
            <Badge tone={market.resolvedAs === "YES" ? "yes" : "no"}>
              {market.resolvedAs}
            </Badge>{" "}
            on {market.resolvedAt?.toLocaleString()}.
          </p>
          {market.resolutionNote && (
            <p className="mt-2 text-sm text-slate-400">{market.resolutionNote}</p>
          )}
        </Card>
      )}

      {market.status === "CANCELLED" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Cancelled</CardTitle>
          </CardHeader>
          <p className="text-sm text-slate-300">
            Cancelled on {market.resolvedAt?.toLocaleString()}. All positions
            were refunded their cost basis.
          </p>
          {market.resolutionNote && (
            <p className="mt-2 text-sm text-slate-400">{market.resolutionNote}</p>
          )}
        </Card>
      )}

      {!isFinal && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Edit details</CardTitle>
          </CardHeader>
          <MarketForm
            market={{
              id: market.id,
              title: market.title,
              description: market.description,
              bannerUrl: market.bannerUrl,
              category: market.category,
              resolutionSource: market.resolutionSource,
              endsAt: market.endsAt.toISOString(),
              featured: market.featured,
              groupId: market.groupId,
              groupSortOrder: market.groupSortOrder,
            }}
            groups={groups}
          />
        </Card>
      )}
    </div>
  );
}
