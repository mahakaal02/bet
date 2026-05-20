import { Role } from '@prisma/client';

/**
 * Permission slugs that gate admin routes. The slug format is
 * `<resource>.<verb>` (e.g. `audit.view`, `withdrawal.approve`,
 * `user.ban`). New slugs land alongside the routes that need them
 * — additive only, never re-key an existing slug or the role-to-
 * permission map below has to migrate in lockstep.
 *
 * Two wildcards are recognised at evaluation time:
 *
 *   - `'*'`        — match everything (ADMIN).
 *   - `'*.view'`   — match every `*.view` slug (AUDITOR — read-only
 *                    forensic / financial / dashboard access).
 *
 * Anything else is an exact-string match.
 */
export type Permission =
  | '*'
  | '*.view'
  // Audit log
  | 'audit.view'
  // User management (consumed by future PRs — PR-PROFILE-1, PR-FRAUD-1)
  | 'user.view'
  | 'user.ban'
  | 'user.unban'
  | 'user.edit_display_name'
  | 'user.edit_avatar'
  // Withdrawals — owned by Bet but the slugs live here for parity
  | 'withdrawal.approve'
  | 'withdrawal.reject'
  | 'withdrawal.view'
  // Ledger + reconciliation
  | 'ledger.view'
  | 'ledger.export'
  | 'reconciliation.view'
  // Support tickets — consumed by PR-TICKETS-1
  | 'ticket.view'
  | 'ticket.reply'
  // KYC review — consumed by PR-KYC-2
  | 'kyc.view'
  | 'kyc.review';

/**
 * Role → permissions mapping. Matches Roadmap §F-ADMIN-6.
 *
 *   - ADMIN: full god-mode via the `'*'` wildcard.
 *   - FINANCE: withdrawal approve/reject + ledger reads + recon.
 *   - MODERATOR: user moderation + read-only audit access.
 *   - SUPPORT: ticket access + read-only user data.
 *   - AUDITOR: read-only everything via the `'*.view'` wildcard,
 *              plus the two explicit slugs that are themselves
 *              `*.view` already (kept for grep-ability).
 *
 * Two roles each grant `audit.view`: MODERATOR and AUDITOR. That's
 * intentional — moderators need the audit lens when investigating
 * a ban; auditors need it as their core job.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['*'],
  // FINANCE owns withdrawal approvals + ledger + KYC review (no dedicated
  // COMPLIANCE role yet — squatting on FINANCE keeps the Prisma Role enum
  // stable until the next RBAC refactor adds COMPLIANCE explicitly).
  FINANCE: [
    'withdrawal.approve',
    'withdrawal.reject',
    'withdrawal.view',
    'ledger.view',
    'ledger.export',
    'reconciliation.view',
    'kyc.view',
    'kyc.review',
  ],
  MODERATOR: [
    'user.view',
    'user.ban',
    'user.unban',
    'user.edit_display_name',
    'user.edit_avatar',
    'audit.view',
  ],
  SUPPORT: ['ticket.view', 'ticket.reply', 'user.view'],
  AUDITOR: ['*.view', 'audit.view', 'reconciliation.view', 'kyc.view'],
};

/**
 * Decide whether `held` (a flat union of permission slugs the user
 * has) satisfies the `required` slug. Pure helper — heavily unit-
 * tested.
 *
 *   - exact match: `'audit.view' ∈ held` → true
 *   - `'*'` in held → always true (ADMIN)
 *   - `'*.view'` in held + `required` ends in `.view` → true (AUDITOR)
 */
export function permissionGranted(
  held: ReadonlySet<Permission>,
  required: Permission,
): boolean {
  if (held.has('*')) return true;
  if (held.has(required)) return true;
  if (held.has('*.view') && required.endsWith('.view')) return true;
  return false;
}

/**
 * Flatten an array of roles into the union of their permissions.
 * Used at request-time by the PermsGuard.
 */
export function permissionsForRoles(
  roles: readonly Role[],
): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) {
    for (const p of ROLE_PERMISSIONS[r] ?? []) {
      out.add(p);
    }
  }
  return out;
}
