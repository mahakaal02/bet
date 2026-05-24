import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <ComingSoon
      kicker="Platform"
      title="System settings"
      description="Trading fees, settlement delays, currencies, KYC providers, oracle integrations, API keys."
      intent="Global configuration surface. Every setting is a key/value pair with type metadata (number / string / bool / json) and live-edit audit trail. Changes apply on save without a redeploy — the SettingsService TTL'd cache on the bet side picks up updates within 60s. Sensitive secrets (oracle API keys, payment provider credentials) live in a separate vault-backed view with masked display and reveal-on-click."
      needs={[
        "Existing backend SettingsService already supports key-value config with audit (PR-FEATURE-FLAGS-2). Bet would need its own Setting model OR sync the relevant keys via the cross-service shared-secret API.",
        "GET /api/admin/settings — list of settings + current values + last edited.",
        "PATCH /api/admin/settings/[key] — updates one value, logs to AdminLog.",
        "GET /api/admin/settings/[key]/history — change log per key.",
        "Settings catalogue declared in code (TS const) so new keys are typed: { key, label, type, defaultValue, description, sensitive }[].",
        "Secret values rendered as ••••XYZ with a 'reveal' button gated behind a re-auth prompt.",
      ]}
    />
  );
}
