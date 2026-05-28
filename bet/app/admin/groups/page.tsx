import Link from "next/link";
import type { MarketCategory } from "@prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { GroupForm } from "@/components/admin/GroupForm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin events index — list every market group + an inline "new event" form.
 * Groups are display/settlement metadata over existing binary markets; markets
 * are attached by editing each market (its "Event / group" field). Manage a
 * single event (edit, member list, resolve) at /admin/groups/[id].
 */
export default async function AdminGroupsPage() {
  const groups = await db.marketGroup.findMany({
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { markets: true } } },
  });

  return (
    <div className="py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-black">Events</h1>
        <p className="text-sm text-slate-400">
          Bundle related YES/NO markets into one ranked event. Attach markets by
          editing a market and choosing its event.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>
              {groups.length} {groups.length === 1 ? "event" : "events"}
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2">Cat</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Markets</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                      No events yet. Create one on the right.
                    </td>
                  </tr>
                )}
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="py-2 pr-2">
                      <Link
                        href={`/admin/groups/${g.id}`}
                        className="line-clamp-1 max-w-xs hover:text-slate-100"
                      >
                        {g.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge>{g.category as MarketCategory}</Badge>
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-400">{g.type}</td>
                    <td className="py-2 pr-2">
                      <Badge
                        tone={
                          g.status === "OPEN"
                            ? "info"
                            : g.status === "RESOLVED"
                              ? "yes"
                              : "warn"
                        }
                      >
                        {g.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-2 font-mono">{g._count.markets}</td>
                    <td className="py-2 pr-2 text-right">
                      <Link
                        href={`/admin/groups/${g.id}`}
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

        <Card>
          <CardHeader>
            <CardTitle>New event</CardTitle>
          </CardHeader>
          <GroupForm />
        </Card>
      </div>
    </div>
  );
}
