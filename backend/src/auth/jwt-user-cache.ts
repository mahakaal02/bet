import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { TtlCache } from '../foundation/ttl-cache';

/**
 * Short-TTL, per-process cache of the `User` row that
 * `AuthService.validateJwt()` loads on EVERY authenticated request.
 *
 * Without it, each authed request does TWO point reads: the user row
 * (here) and the responsible-gambling profile (the self-exclusion
 * gate). A page that fires a handful of authed XHRs at once therefore
 * does N user reads for the same principal. This cache collapses that
 * burst to a single read while keeping the security contract intact:
 *
 *   - The RG self-exclusion / cool-down check is a COMPLIANCE control
 *     and is deliberately NOT cached — `validateJwt()` still calls
 *     `rg.assertCanLogin()` live on every request, so a freshly
 *     self-excluded gambler is blocked immediately.
 *
 *   - The cached row feeds the `passwordChangedAt` session-invalidation
 *     check and the sanitized request principal only. Password resets
 *     bump `passwordChangedAt` to kill existing JWTs and call
 *     {@link invalidate} here, so the kill is immediate on this pod.
 *     Account-deletion purge also bumps it, but purge runs ~30 days
 *     after the request — far beyond this TTL — so it needs no hook.
 *
 *   - Cross-pod, the worst case is bounded by {@link TTL_MS}: a stale
 *     row lingers at most a few seconds, the same staleness contract
 *     every other foundation `TtlCache` carries (see ttl-cache.ts).
 *
 * {@link TTL_MS} is intentionally tiny. A couple of seconds of
 * `passwordChangedAt` staleness is immaterial next to a JWT's
 * multi-day natural lifetime; the cache exists to absorb bursts, not
 * to hold rows for minutes.
 */
@Injectable()
export class JwtUserCache {
  static readonly TTL_MS = 5_000;
  private readonly cache = new TtlCache<User>(JwtUserCache.TTL_MS);

  get(userId: string): User | undefined {
    return this.cache.get(userId);
  }

  set(user: User): void {
    this.cache.set(user.id, user);
  }

  invalidate(userId: string): void {
    this.cache.invalidate(userId);
  }
}
