import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  return (
    <ComingSoon
      kicker="Markets"
      title="Order book inspector"
      description="Cross-market order browser with force-cancel, freeze, and refund tools."
      intent="An admin view of every limit + market order across the platform, filterable by market, side (YES/NO), status (OPEN / PARTIAL / FILLED / CANCELLED), and user. Each row should expose the same force-cancel action already wired in the market-detail Orders tab — plus a freeze action (block further fills without cancelling the reservation) and a manual-refund button for stuck reservations."
      needs={[
        "GET /api/admin/orders endpoint — paginated, accepts {marketId?, status?, side?, userId?, page, pageSize}. Wraps existing Prisma Order model.",
        "POST /api/admin/orders/[id]/freeze — pauses matching without cancelling.",
        "POST /api/admin/orders/[id]/refund — atomic refund for orders the matcher failed to settle.",
        "Order model needs a `frozenAt: DateTime?` column (this WOULD be a schema change — gated until you authorise it).",
      ]}
    />
  );
}
