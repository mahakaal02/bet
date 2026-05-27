import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Admin knobs for Aviator (PR-ARCH-AUDIT, Stage B — extracted from
 * the AviatorService god-class).
 *
 *   - `maxPayout`        — global ceiling clipped onto every round's
 *                          natural crash. null = uncapped.
 *   - `forcedNextPayout` — one-shot override consumed at the start of
 *                          the next BETTING phase.
 *
 * Both live on the singleton `AviatorSettings` row (id=1). The
 * consume operation is intentionally atomic so two racing phase
 * starts cannot both fire the same forced value.
 */
@Injectable()
export class AviatorKnobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the admin's max-payout ceiling. Returns null when unset
   * (the default — uncapped). The ceiling is advisory only: round
   * seeds are still computed from the provably-fair RNG, the cap
   * just clips the published crash point.
   */
  async readMaxPayout(): Promise<number | null> {
    const row = await this.prisma.aviatorSettings.findUnique({
      where: { id: 1 },
      select: { maxPayout: true },
    });
    if (!row?.maxPayout) return null;
    const n = Number(row.maxPayout.toString());
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Atomically read-and-clear `forcedNextPayout`. The UPDATE … WHERE
   * forcedNextPayout IS NOT NULL guard means two concurrent phase
   * starts can't both consume the same value — only one UPDATE
   * matches a row; the other returns 0 affected rows and we hand
   * back null.
   */
  async consumeForcedNextPayout(): Promise<number | null> {
    const before = await this.prisma.aviatorSettings.findUnique({
      where: { id: 1 },
      select: { forcedNextPayout: true },
    });
    if (!before?.forcedNextPayout) return null;
    const result = await this.prisma.aviatorSettings.updateMany({
      where: { id: 1, forcedNextPayout: { not: null } },
      data: { forcedNextPayout: null },
    });
    if (result.count === 0) return null;
    const n = Number(before.forcedNextPayout.toString());
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  /**
   * Read the current admin knobs (for the admin UI to render).
   * Lazily creates the singleton row if a previous deploy somehow
   * missed the migration's seed insert.
   */
  async getAdminSettings() {
    const row = await this.prisma.aviatorSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    return {
      maxPayout: row.maxPayout?.toString() ?? null,
      forcedNextPayout: row.forcedNextPayout?.toString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Patch one or both admin knobs. Each field is optional — omit to
   * leave unchanged, send `null` to clear, send a string decimal to
   * set. Validation: positive numbers, fixed-payout ≥ 1.00 since the
   * crash multiplier can never go below 1.
   */
  async updateAdminSettings(input: {
    maxPayout?: string | null;
    forcedNextPayout?: string | null;
  }) {
    const data: { maxPayout?: string | null; forcedNextPayout?: string | null } = {};
    if (input.maxPayout !== undefined) {
      if (input.maxPayout === null || input.maxPayout === '') {
        data.maxPayout = null;
      } else {
        const n = Number(input.maxPayout);
        if (!Number.isFinite(n) || n < 1) {
          throw new BadRequestException(
            'maxPayout must be ≥ 1.00 (or omit/null to clear)',
          );
        }
        data.maxPayout = n.toFixed(2);
      }
    }
    if (input.forcedNextPayout !== undefined) {
      if (input.forcedNextPayout === null || input.forcedNextPayout === '') {
        data.forcedNextPayout = null;
      } else {
        const n = Number(input.forcedNextPayout);
        if (!Number.isFinite(n) || n < 1) {
          throw new BadRequestException(
            'forcedNextPayout must be ≥ 1.00 (or omit/null to clear)',
          );
        }
        data.forcedNextPayout = n.toFixed(2);
      }
    }
    await this.prisma.aviatorSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return this.getAdminSettings();
  }
}
