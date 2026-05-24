import { db } from "@/lib/db";
import {
  Badge,
  Card,
  PageHeader,
  fmtDate,
} from "@/components/admin/ui/primitives";
import { IconSettings } from "@/components/admin/ui/icons";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

/**
 * System settings (PR-BET-ADMIN-REDESIGN).
 *
 * Key/value config surface backed by the new AdminSetting table.
 * The catalogue (declared in code below) defines which keys exist
 * + their types; any keys not in the catalogue are still readable
 * from the DB but not exposed as editable here (defence in depth
 * against silent setting drift).
 */
const CATALOGUE = [
  {
    key: "trading.fee_pct",
    label: "Trading fee (%)",
    type: "number" as const,
    category: "Fees",
    defaultValue: 2,
    description:
      "Commission skimmed from every trade. Applied at fill time; see lib/commission.ts.",
  },
  {
    key: "trading.min_bet_coins",
    label: "Minimum bet (coins)",
    type: "number" as const,
    category: "Limits",
    defaultValue: 100,
    description: "Smallest stake any user can place on a single order.",
  },
  {
    key: "trading.max_exposure_coins",
    label: "Per-user exposure cap (coins)",
    type: "number" as const,
    category: "Limits",
    defaultValue: 1000000,
    description: "Maximum locked-in-orders any one user can carry. Hard rejects further orders.",
  },
  {
    key: "settlement.dispute_window_hours",
    label: "Dispute window (hours)",
    type: "number" as const,
    category: "Settlement",
    defaultValue: 24,
    description: "Time after resolution during which users can dispute the outcome.",
  },
  {
    key: "settlement.auto_settle_enabled",
    label: "Auto-settle on oracle confirm",
    type: "boolean" as const,
    category: "Settlement",
    defaultValue: false,
    description: "When the resolution source returns a confidence ≥ threshold, auto-resolve without admin click.",
  },
  {
    key: "kyc.required_for_withdrawal",
    label: "Require KYC for withdrawal",
    type: "boolean" as const,
    category: "KYC",
    defaultValue: false,
    description: "Withdrawals over the threshold reject when the user is not KYC-approved.",
  },
  {
    key: "kyc.required_threshold_coins",
    label: "KYC withdrawal threshold (coins)",
    type: "number" as const,
    category: "KYC",
    defaultValue: 10000,
    description: "Withdrawals at or above this amount require approved KYC.",
  },
  // PR-BET-ADMIN-FOLLOWUPS — Secured Kalki Chat App download URL.
  // Surfaced on the user-facing wallet page as the "Download Secured
  // Chat App now" link under the coin-pack tiles. Empty string means
  // no link is shown (the page degrades to "ask the super admin to
  // set this in /admin/settings"). Super admin pastes a signed APK
  // URL (Cloudflare R2 / S3 / direct download); whatever URL is here
  // is what users tap.
  {
    key: "wallet.chat_app_download_url",
    label: "Secured Chat App APK URL",
    type: "string" as const,
    category: "Wallet",
    defaultValue: "",
    description:
      "User-facing wallet shows 'Download Secured Chat App now' linking here. Paste a direct .apk URL (e.g. an S3 signed URL or your hosted download).",
  },
];

export default async function SettingsPage() {
  const rows = await db.adminSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const settings = CATALOGUE.map((c) => ({
    ...c,
    value: byKey.get(c.key)?.value ?? c.defaultValue,
    updatedAt: byKey.get(c.key)?.updatedAt.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        kicker="Platform"
        title="System settings"
        description="Platform-wide configuration. Changes apply within 60s via the SettingsService cache; every edit is audited."
        actions={<Badge tone="info" dot>{settings.length} keys</Badge>}
      />

      <SettingsClient settings={settings} />

      <Card className="mt-5 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--admin-elevated)] text-[var(--admin-text-secondary)]">
            <IconSettings size={16} />
          </div>
          <div className="text-xs text-[var(--admin-text-secondary)]">
            <strong className="text-[var(--admin-text-primary)]">How it works:</strong> the
            catalogue above is declared in code (
            <code className="font-mono">bet/app/admin/settings/page.tsx</code>) so new
            setting kinds can't accidentally appear in the editor without a
            deploy. Values are stored in the <code>AdminSetting</code> table
            with full edit history via <code>AdminLog</code>; the readers
            (e.g. <code>lib/commission.ts</code>) consume via a thin cached
            wrapper.
          </div>
        </div>
      </Card>
    </>
  );
}
