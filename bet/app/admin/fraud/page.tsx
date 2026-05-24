import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function FraudPage() {
  return (
    <ComingSoon
      kicker="Trust & safety"
      title="Fraud & risk console"
      description="Heuristic + ML signals, suspicious-pattern triage, and emergency platform controls."
      intent="Three-pane layout: signal feed (left), user/market drill-in (centre), action surface (right). Surfaces wash-trading clusters (correlated YES/NO trades within seconds across multi-account rings), unusual betting spikes (3σ above per-market baseline), and bot-like activity (sub-second click rhythm). Plus a kill-switch panel: pause trading, freeze a market, halt all payouts, force-settle to refund — every action gated behind a multi-admin co-sign for real-money safety."
      needs={[
        "FraudSignal model: { id, kind, severity, userId?, marketId?, evidence (JSON), status, reviewedBy? }.",
        "Background worker that scans Trade + Order streams every minute and inserts signals.",
        "GET /api/admin/fraud/signals?status=&severity=&page=",
        "POST /api/admin/fraud/signals/[id]/{review,dismiss,escalate}",
        "Emergency-controls endpoints: /api/admin/emergency/{pause-market,freeze-trading,halt-payouts}. Each requires X-Admin-Multisig header with N co-signed JWTs.",
        "Optional: ML scoring service for cluster detection (multi-account triangulation). Out-of-scope for the first ship; the heuristic version covers 80% of detected cases.",
      ]}
    />
  );
}
