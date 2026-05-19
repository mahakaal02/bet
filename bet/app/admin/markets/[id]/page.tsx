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
 * panels. The Resolve panel only renders for OPEN markets; the Edit
 * panel hides once a market is RESOLVED (we don't allow re-edits, the
 * resolution route gates that).
 */
export default async function MarketOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const market = await db.market.findUnique({ where: { id } });
  if (!market) notFound();

  return (
    <div className="max-w-3xl">
      {market.status === "OPEN" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Resolve</CardTitle>
          </CardHeader>
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

      {market.status !== "RESOLVED" && (
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
            }}
          />
        </Card>
      )}
    </div>
  );
}
