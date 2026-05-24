import { db } from "@/lib/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  fmtDate,
} from "@/components/admin/ui/primitives";
import { IconShield, IconUsers } from "@/components/admin/ui/icons";

export const dynamic = "force-dynamic";

/**
 * KYC review queue (PR-BET-ADMIN-REDESIGN).
 *
 * Lists KycSubmission rows in PENDING / REQUEST_MORE state. Once the
 * user-side submission UI lands, this table fills up; for now the
 * page renders the empty state cleanly so operators see the surface
 * and the data shape.
 */
export default async function KycPage() {
  const [pending, recent, approved] = await Promise.all([
    db.kycSubmission.count({ where: { status: "PENDING" } }),
    db.kycSubmission.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.kycSubmission.count({ where: { status: "APPROVED" } }),
  ]);

  return (
    <>
      <PageHeader
        kicker="Trust & safety"
        title="KYC review"
        description="Customer identity-verification queue. Each submission carries PAN / Aadhaar / selfie refs + an auto face-match score."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Pending" value={pending.toLocaleString("en-IN")} tone={pending > 0 ? "warning" : "success"} icon={<IconShield size={18} />} />
        <StatCard label="Approved" value={approved.toLocaleString("en-IN")} tone="success" icon={<IconUsers size={18} />} />
        <StatCard label="Lifetime submissions" value={recent.length.toLocaleString("en-IN")} icon={<IconShield size={18} />} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] px-4 py-3">
          <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
            Submissions
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">User ID</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Face match</th>
              <th className="px-3 py-2 text-right">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {recent.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={<IconShield size={18} />}
                    title="No KYC submissions yet"
                    description="User-side KYC flow ships in a follow-up. The table + endpoints are ready; submissions will appear here automatically."
                  />
                </td>
              </tr>
            )}
            {recent.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-mono text-xs">{s.userId.slice(0, 12)}…</td>
                <td className="px-3 py-2">
                  <Badge tone={kycTone(s.status)} dot>
                    {s.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {s.faceMatchScore != null ? `${(s.faceMatchScore * 100).toFixed(0)}%` : "—"}
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

function kycTone(s: string): "warning" | "success" | "danger" | "info" {
  if (s === "APPROVED") return "success";
  if (s === "REJECTED") return "danger";
  if (s === "REQUEST_MORE") return "info";
  return "warning";
}
