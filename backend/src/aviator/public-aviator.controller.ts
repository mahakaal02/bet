import { Controller, Get } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * Anonymous-readable aviator stats — endpoints that don't require a
 * signed-in user. Surfaced as a separate controller (rather than a
 * `@Public()` decorator on the main `AviatorController`) because
 * `AviatorController` has a class-level `@UseGuards(JwtAuthGuard)`
 * and Nest's guard composition only stacks — there's no "exempt this
 * route" without splitting the class.
 *
 * Anything served here MUST be safe to expose to a logged-out
 * crawler / bot / casual visitor: no PII, no active-bet positions,
 * no unpublished seed material.
 *
 * Routes are throttled so a single client can't hammer the endpoint.
 */
@Controller('aviator/public')
export class PublicAviatorController {
  /**
   * Teaser multiplier range. The marketing landing page is
   * deliberately DE-LINKED from the live aviator engine — it shows a
   * self-contained stream of plausible-looking crash multipliers
   * rather than real round outcomes.
   *
   * The generator lives here (server-side) on purpose: the
   * distribution must not ship in the client bundle, so someone who
   * downloads the web source can't reconstruct how the teaser numbers
   * are produced. The client only ever receives a finished value.
   */
  private static readonly MIN_MULTIPLIER = 5;
  private static readonly MAX_MULTIPLIER = 68.67;

  /**
   * Draw a random teaser multiplier in [MIN, MAX].
   *
   * Log-uniform with a cubic low-bias: most rounds land modestly
   * above the 5x floor (reads like a real crash game) while the tail
   * still occasionally reaches the 68.67x ceiling. Returned with two
   * decimal places to match the on-the-wire shape used elsewhere.
   */
  private randomTeaserMultiplier(): number {
    const min = PublicAviatorController.MIN_MULTIPLIER;
    const max = PublicAviatorController.MAX_MULTIPLIER;
    const biased = Math.pow(Math.random(), 3);
    const value = min * Math.pow(max / min, biased);
    return Math.round(value * 100) / 100;
  }

  /**
   * GET /aviator/public/teaser-multiplier
   *
   * Returns a freshly generated random multiplier for the landing
   * page's aviator widget. Not tied to any real round — each request
   * is an independent draw.
   *
   * Response shape:
   *   { multiplier: "1284.55" }
   *
   * `multiplier` is a stringified decimal (matches the rest of the
   * aviator API, which serialises Prisma `Decimal` as a string to
   * avoid float precision loss on 64-bit clients).
   */
  // Cheap, DB-free, public value. Keep a sane per-minute cap via the
  // `default` throttler but exempt it from the aggressive `bid`
  // limiter (5/10s) — the landing page prefetches one value per round
  // and the Next.js proxy funnels every visitor through a single
  // server IP, so the short-window limiter would otherwise throttle
  // legitimate traffic and force the client onto its fallback.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @SkipThrottle({ bid: true })
  @Get('teaser-multiplier')
  teaserMultiplier(): { multiplier: string } {
    return { multiplier: this.randomTeaserMultiplier().toFixed(2) };
  }
}
