import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function ReportsAnalyticsPage() {
  return (
    <ComingSoon
      kicker="Compliance"
      title="Reports & exports"
      description="On-demand CSV/Excel/PDF reports for revenue, user P&L, settlements, fraud, and tax."
      intent="Pre-built report templates (revenue rollup, market performance, user profitability, settlement audit, fraud-signal summary, GST/TDS export) plus an ad-hoc query builder. Each report runs as a background job; the operator gets a notification when the file is ready in S3 with a signed-URL download. Retention: reports persist for 90 days, then auto-pruned."
      needs={[
        "Report model: { id, template, params (JSON), status (PENDING/RUNNING/READY/FAILED), s3Key, requestedBy, expiresAt }.",
        "BullMQ job queue + worker that runs the template SQL/Prisma → CSV-streams → uploads to S3.",
        "GET /api/admin/reports/templates (static list of report kinds).",
        "POST /api/admin/reports — enqueues a job.",
        "GET /api/admin/reports/[id] — status + signed download URL.",
        "S3 bucket: kalki-reports/<reportId>.csv (already provisioned for KYC; just need a folder).",
        "PDF generation deferred to a follow-up (CSV + Excel cover 95% of real ops needs).",
      ]}
    />
  );
}
