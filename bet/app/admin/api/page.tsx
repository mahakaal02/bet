import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function ApiMonitoringPage() {
  return (
    <ComingSoon
      kicker="Platform"
      title="API & webhook monitoring"
      description="Real-time request logs, webhook delivery status, retry queue, system health."
      intent="Observability surface for the operations team. Request log: rolling 5k API calls with status / latency / actor. Webhook delivery: per-tenant queue of outbound webhooks with success / failure / retry state. System health: queue depths (BullMQ), DB connection pool, Redis pubsub lag, current SSE subscriber count per market. The kind of console you keep open on a wall display during an incident."
      needs={[
        "Request-log middleware that writes structured rows to ApiLog (already partial — backend has request logging; bet currently does not).",
        "WebhookEndpoint model: { id, url, secret, enabled, retryConfig }. WebhookDelivery model: { id, endpointId, eventId, status, attempts, responseStatus }.",
        "GET /api/admin/api-logs?status=&since=&page=",
        "GET /api/admin/webhooks + per-endpoint /deliveries.",
        "POST /api/admin/webhooks/[id]/test — fires a sample event at the endpoint and records the result.",
        "Metrics exporter (Prometheus textfile or pull endpoint) for queue depths + DB stats — already exposed by backend, just needs to be displayed.",
      ]}
    />
  );
}
