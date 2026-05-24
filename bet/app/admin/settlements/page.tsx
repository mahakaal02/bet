import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function SettlementsPage() {
  return (
    <ComingSoon
      kicker="Markets"
      title="Settlement queue"
      description="Multi-admin approval workflow for market resolutions, with simulation preview."
      intent="Dedicated queue for markets where trading has ended and a resolution is pending. Each row shows the proposed outcome, simulated payout breakdown (winning users, losing users, fees, refunds, LP returns), and the approval workflow status (requires N admin co-signs). Resolves invoke the existing /api/admin/markets/[id]/resolve atomic settlement; here the UI just orchestrates the approval state."
      needs={[
        "Settlement model: { marketId, proposedOutcome, proposedBy, status (PENDING/APPROVED/EXECUTED/REJECTED), approvals[] }.",
        "GET /api/admin/settlements?status=&page=",
        "POST /api/admin/settlements/[id]/approve — records the current admin's sign-off, transitions to APPROVED when threshold reached.",
        "Settlement simulation engine: pure function that takes (marketId, outcome) and returns the exact ledger writes /api/admin/markets/[id]/resolve would emit, without persisting them.",
      ]}
    />
  );
}
