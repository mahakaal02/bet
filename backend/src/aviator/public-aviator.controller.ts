import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AviatorService } from './aviator.service';

/**
 * Anonymous-readable aviator stats — endpoints that don't require a
 * signed-in user. Surfaced as a separate controller (rather than a
 * `@Public()` decorator on the main `AviatorController`) because
 * `AviatorController` has a class-level `@UseGuards(JwtAuthGuard)`
 * and Nest's guard composition only stacks — there's no "exempt this
 * route" without splitting the class.
 *
 * Anything served here MUST be safe to expose to a logged-out
 * crawler / bot / casual visitor:
 *   - No personally identifying data.
 *   - No active-bet positions.
 *   - No seed material that hasn't been published yet (post-crash
 *     `serverSeed` reveal is fine; pre-crash reveal would break the
 *     fairness contract).
 *
 * Routes are throttled so a single client can't hammer the DB with
 * "last crash" polls and amplify load on the read replica.
 */
@Controller('aviator/public')
export class PublicAviatorController {
  constructor(private readonly aviator: AviatorService) {}

  /**
   * GET /aviator/public/last-crash
   *
   * Returns the most recently CRASHED round's multiplier and crash
   * timestamp. Drives the "Last crash" stat tile on the unauthed
   * auctions landing page — gives visitors a real, live data point
   * instead of a fake one, which is one of the strongest social-
   * proof signals on the page.
   *
   * Response shape:
   *   { multiplier: "8.42", at: "2026-05-26T19:14:03.221Z" }
   *
   * `multiplier` is a string (matches the rest of the aviator API —
   * `crashMultiplier` is `Decimal` in Prisma and we serialise as a
   * string to avoid float precision loss for 64-bit clients).
   *
   * Empty fallback `{ multiplier: null, at: null }` lets the client
   * know there's no published round yet (e.g. fresh DB / pre-launch)
   * so it can render the local placeholder without retrying forever.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('last-crash')
  async lastCrash(): Promise<{
    multiplier: string | null;
    at: string | null;
  }> {
    const [latest] = await this.aviator.recentRounds(1);
    if (!latest) return { multiplier: null, at: null };
    return {
      multiplier: latest.crashMultiplier,
      at: latest.crashedAt?.toISOString() ?? null,
    };
  }
}
