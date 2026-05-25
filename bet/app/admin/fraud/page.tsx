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
import { IconAlert, IconShield } from "@/components/admin/ui/icons";
import { FraudScanButton } from "./FraudScanButton";

export const dynamic = "force-dynamic";

/**
 * Fraud & risk console (PR-BET-ADMIN-REDESIGN).
 *
 * Lists every FraudSignal in OPEN / REVIEWED / ESCALATED state. A
 * follow-up background worker populates this table by scanning Trade
 * + Order streams for suspicious patterns; in the meantime, the page
 * renders the empty state cleanly so operators see the surface and
 * understand what's coming.
 */
export default async function FraudPage() {
  const [open, recent, critical] = await Promise.all([
    db.fraudSignal.count({ where: { status: "OPEN" } }),
    db.fraudSignal.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.fraudSignal.count({
      where: { severity: "critical", status: { in: ["OPEN", "ESCALATED"] } },
    }),
  ]);

  return (
    <>
      <PageHeader
        kicker="Trust & safety"
        title="Fraud & risk"
        description="Heuristic signals from the trade-stream scanner. Triage from oldest to newest; escalate critical patterns."
        actions={<FraudScanButton />}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Open signals"
          value={open.toLocaleString("en-IN")}
          tone={open > 0 ? "warning" : "success"}
          icon={<IconAlert size={18} />}
        />
        <StatCard
          label="Critical / escalated"
          value={critical.toLocaleString("en-IN")}
          tone={critical > 0 ? "danger" : "success"}
          icon={<IconShield size={18} />}
        />
        <StatCard
          label="Scanner status"
          value="Ready"
          hint="Run manually here or via the 5-min cron"
          tone="info"
          icon={<IconShield size={18} />}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Signal feed
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">
            Inserted by the fraud worker + manual flags. Click any row to
            see evidence + take action.
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Summary</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={<IconShield size={18} />}
                    title="No signals yet"
                    description="The fraud scanner hasn't been deployed. When it lands, suspicious patterns (wash trades, multi-account rings, spike anomalies, bot rhythm) will surface here."
                  />
                </td>
              </tr>
            )}
            {recent.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2">
                  <span className="rounded bg-[var(--admin-elevated)] px-1.5 py-0.5 text-[10px] font-mono">
                    {s.kind}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={severityTone(s.severity)} dot>
                    {s.severity}
                  </Badge>
                </td>
                <td className="px-3 py-2 max-w-[40ch] truncate">{s.summary}</td>
                <td className="px-3 py-2">
                  <Badge>{s.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--admin-text-secondary)]">
                  {fmtDate(s.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function severityTone(s: string): "info" | "warning" | "danger" | "neutral" {
  if (s === "critical") return "danger";
  if (s === "high") return "warning";
  if (s === "medium") return "info";
  return "neutral";
}
