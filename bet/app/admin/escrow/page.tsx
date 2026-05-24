import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function EscrowPage() {
  return (
    <ComingSoon
      kicker="Finance"
      title="Escrow & wallets"
      description="Treasury monitoring with reserve-ratio enforcement and ledger drill-down."
      intent="Live readout of platform float: sum of all user wallet balances + locked-in-order reservations + open position collateral, plotted against an externally-funded treasury account. Reserve ratio alarms (e.g. liquid float < 110% of open interest) trigger immediate ops escalation. Drill into any user's wallet to see their lifetime Transaction ledger as a verifiable double-entry."
      needs={[
        "Treasury balance ingestion (Razorpay payouts account snapshot, refreshed hourly).",
        "ReserveSnapshot model: { at, totalLiquid, totalLocked, totalOpenInterest, treasuryBalance, ratio }.",
        "GET /api/admin/escrow/snapshot — current numbers.",
        "GET /api/admin/escrow/history?range= — chartable timeseries.",
        "GET /api/admin/wallets/[userId]/ledger — paginated Transaction stream for the user.",
        "Reserve-ratio alarm wired to the notifications system once that's live.",
      ]}
    />
  );
}
