import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <ComingSoon
      kicker="Platform"
      title="Notifications"
      description="Channel routing for system events: email, SMS, push, in-app."
      intent="Editor for the notification rule-book — which events fire on which channels for which user segments. Categories: market closed, order cancelled, refund processed, settlement complete, suspicious activity, KYC alerts. Each rule has channel toggles (email / SMS / push / in-app), audience filter (all / specific tier / specific market participants), and a template referenced by ID."
      needs={[
        "NotificationRule model: { event, channels[], audienceFilter (JSON), templateId, enabled }.",
        "NotificationTemplate model: { id, channel, subject, body (Liquid/Handlebars), locale }.",
        "OutboxItem already exists in backend — wire bet to publish into the same outbox so the existing notification worker pipeline (SES / SMS / FCM) drains it.",
        "GET/POST /api/admin/notifications/rules + /templates",
        "Test-send button: POST /api/admin/notifications/test that sends a sample to the requesting admin's own contact info.",
        "Per-user opt-out preferences UI (user-side); admin-side is rule editing only.",
      ]}
    />
  );
}
