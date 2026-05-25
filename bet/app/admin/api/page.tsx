import {
  db } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/admin/ui/primitives";
import { fmtDate } from "@/components/admin/ui/format";
import { IconServer, IconActivity } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * API & webhook monitoring (PR-BET-ADMIN-REDESIGN).
 *
 * Reads from the new ApiLog table. The request-log middleware that
 * writes rows ships in a follow-up; until then the table is empty
 * and the page shows a clean "no entries yet" surface so operators
 * see what's coming.
 */
export default async function ApiMonitoringPage() {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [recent, totalLastHour, errorsLastHour] = await Promise.all([
    db.apiLog.findMany({
      orderBy: { id: "desc" },
      take: 100,
    }),
    db.apiLog.count({ where: { createdAt: { gte: hourAgo } } }),
    db.apiLog.count({
      where: { createdAt: { gte: hourAgo }, status: { gte: 500 } },
    }),
  ]);

  const errorRate = totalLastHour > 0 ? errorsLastHour / totalLastHour : 0;

  return (
    <>
      <PageHeader
        kicker="Platform"
        title="API & webhook monitoring"
        description="Realtime request log + webhook delivery status. The request-log middleware that populates this surface ships in a follow-up."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Requests (last hour)"
          value={totalLastHour.toLocaleString("en-IN")}
          icon={<IconActivity size={18} />}
        />
        <StatCard
          label="5xx errors (last hour)"
          value={errorsLastHour.toLocaleString("en-IN")}
          tone={errorsLastHour > 0 ? "danger" : "success"}
          icon={<IconServer size={18} />}
        />
        <StatCard
          label="Error rate"
          value={`${(errorRate * 100).toFixed(2)}%`}
          tone={errorRate < 0.01 ? "success" : errorRate < 0.05 ? "warning" : "danger"}
          icon={<IconServer size={18} />}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Recent requests
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Method</th>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-right">Status</th>
              <th className="px-3 py-2 text-right">Latency</th>
              <th className="px-3 py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={<IconServer size={18} />}
                    title="No API logs yet"
                    description="Request-logging middleware lands in a follow-up. Once enabled, every API call writes one row here with method / path / status / latency. 30-day retention via a scheduled cleanup."
                  />
                </td>
              </tr>
            )}
            {recent.map((r) => (
              <tr key={String(r.id)}>
                <td className="px-3 py-2">
                  <Badge>{r.method}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.path}</td>
                <td className="px-3 py-2 text-right">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.durationMs}ms</td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(r.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function statusTone(status: number): "success" | "info" | "warning" | "danger" {
  if (status >= 500) return "danger";
  if (status >= 400) return "warning";
  if (status >= 300) return "info";
  return "success";
}
