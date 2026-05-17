import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MarketForm } from "@/components/MarketForm";
import { ResolveMarketPanel } from "@/components/ResolveMarketPanel";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditMarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const u = await getAuthedUser();
  if (!u) redirect(`/login?next=/admin/markets/${id}`);
  if (!u.isAdmin) redirect("/");

  const market = await db.market.findUnique({
    where: { id },
    include: { _count: { select: { trades: true, positions: true } } },
  });
  if (!market) notFound();

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">
            ← Back to admin
          </Link>
          <Badge>{market.category}</Badge>
          <Badge
            tone={
              market.status === "OPEN"
                ? "info"
                : market.status === "RESOLVED"
                  ? "yes"
                  : market.status === "CANCELLED"
                    ? "warn"
                    : "default"
            }
          >
            {market.status}
          </Badge>
        </div>
        <h1 className="text-2xl font-black">{market.title}</h1>
        <p className="text-xs text-slate-500">
          {market._count.trades} trades · {market._count.positions} positions ·{" "}
          {fmtCoins(market.volumeCoins)} volume
        </p>

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
    </main>
  );
}
