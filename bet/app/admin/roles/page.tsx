import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  return (
    <ComingSoon
      kicker="Users"
      title="Roles & access"
      description="Role-based access control with five tiers: Super / Market / Finance / Compliance / Support."
      intent="Matrix UI: rows are admins, columns are role capabilities (create market, resolve market, approve payouts, freeze users, access reports, manage fees, system settings). Granting / revoking a single permission is a one-click toggle with an audit-log entry. Super-admin role is bootstrapped via env (KALKI_SUPER_ADMIN_USERS) and cannot be revoked from the UI — must be revoked at the secret level."
      needs={[
        "AdminRole model: { userId, role (enum: SUPER, MARKET, FINANCE, COMPLIANCE, SUPPORT), grantedBy, grantedAt, revokedAt? }. Currently bet has a flat User.isAdmin boolean; this would split it.",
        "Permission set per role (capabilities matrix) declared in code, not DB — declarative ACL.",
        "JwtAuthGuard reads roles from the JWT claims and enforces per-route.",
        "GET /api/admin/admins — list of admins + their roles.",
        "POST /api/admin/admins/[id]/grant|revoke",
        "Already-existing AdminLog model captures every grant/revoke for free.",
      ]}
    />
  );
}
