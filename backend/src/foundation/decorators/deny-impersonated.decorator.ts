import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the @DenyImpersonated() decorator.
 * Read by ImpersonationScopeGuard via the Reflector to determine
 * which routes refuse impersonation-purpose JWTs.
 */
export const DENY_IMPERSONATED_KEY = 'denyImpersonated';

/**
 * Marks a route (or whole controller) as off-limits to impersonation
 * sessions (PR-ARCH-AUDIT, Stage A). When an admin assumes a user's
 * identity via /admin/impersonate, the resulting JWT carries
 * `purpose: 'impersonation'`. Such tokens authenticate normal user
 * routes (so the admin can see what the user sees) but MUST NOT be
 * allowed to:
 *
 *   - top up the wallet via Razorpay (real money)
 *   - request a withdrawal
 *   - delete the account / request data export
 *   - place bids / aviator bets with real coins
 *   - change password / 2FA / email
 *
 * Tag those endpoints with @DenyImpersonated() and the guard will
 * return 403 IMPERSONATION_FORBIDDEN.
 *
 * Read-only endpoints (GET /me/profile, GET /wallet/balance, etc.)
 * intentionally do NOT carry this decorator — the admin needs to
 * see what the user sees to do their job.
 */
export const DenyImpersonated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(DENY_IMPERSONATED_KEY, true);
