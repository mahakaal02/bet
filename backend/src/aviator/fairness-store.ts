import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateServerSeed,
  hashServerSeed,
  deriveClientSeed,
} from './fairness';

const MAX_ROUNDS_PER_SEED = 1_000; // auto-rotate ceiling

export interface ActiveSeed {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  startRoundNumber: number | null;
}

/**
 * Owns the active seed used by the game loop. The seed batches the next N
 * rounds (each with an incrementing nonce). Rotation reveals the seed so
 * users can verify every round that used it.
 *
 * Concurrent rotations are prevented by checking `isActive` at rotation time.
 */
@Injectable()
export class FairnessStore implements OnModuleInit {
  private readonly logger = new Logger(FairnessStore.name);
  private active: ActiveSeed | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadActive();
  }

  private async loadActive() {
    const row = await this.prisma.aviatorFairnessSeed.findFirst({
      where: { isActive: true },
      orderBy: { startedAt: 'desc' },
    });
    if (row) {
      this.active = {
        id: row.id,
        serverSeed: row.serverSeed,
        serverSeedHash: row.serverSeedHash,
        clientSeed: row.clientSeed,
        startRoundNumber: row.startRoundNumber,
      };
      this.logger.log(`loaded active seed ${row.id.slice(0, 8)}…`);
    }
  }

  async getOrCreateActive(previousRoundNumber: number): Promise<ActiveSeed> {
    if (this.active) return this.active;
    return this.mint(previousRoundNumber, null);
  }

  /**
   * Bind the active seed to a starting round number once we know it (i.e.
   * after the seed is first used). Idempotent.
   */
  async markStartRound(seedId: string, roundNumber: number) {
    if (this.active?.id !== seedId || this.active.startRoundNumber !== null) return;
    await this.prisma.aviatorFairnessSeed.update({
      where: { id: seedId },
      data: { startRoundNumber: roundNumber },
    });
    this.active.startRoundNumber = roundNumber;
  }

  /**
   * Reveal the active seed, mark it inactive, and mint a fresh one for the
   * next round. Returns the now-revealed seed (for broadcast) and the new
   * active seed (used immediately by the game loop).
   */
  async rotate(
    reason: 'scheduled' | 'admin' | 'max_rounds',
    lastRoundNumber: number,
  ): Promise<{ revealed: ActiveSeed & { revealedAt: Date; endRoundNumber: number | null }; next: ActiveSeed }> {
    const current = this.active;
    if (!current) throw new Error('no active seed to rotate');

    const revealedAt = new Date();
    await this.prisma.aviatorFairnessSeed.update({
      where: { id: current.id },
      data: {
        isActive: false,
        revealedAt,
        rotationReason: reason,
        endRoundNumber: lastRoundNumber,
      },
    });

    const next = await this.mint(lastRoundNumber, current.serverSeed);
    this.logger.log(`rotated seed (${reason}) → ${next.id.slice(0, 8)}…`);
    return {
      revealed: { ...current, revealedAt, endRoundNumber: lastRoundNumber },
      next,
    };
  }

  private async mint(previousRoundNumber: number, previousServerSeed: string | null): Promise<ActiveSeed> {
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const clientSeed = deriveClientSeed(previousServerSeed, previousRoundNumber);
    const row = await this.prisma.aviatorFairnessSeed.create({
      data: { serverSeed, serverSeedHash, clientSeed, isActive: true },
    });
    this.active = {
      id: row.id,
      serverSeed,
      serverSeedHash,
      clientSeed,
      startRoundNumber: null,
    };
    return this.active;
  }

  /** Hard ceiling so a never-rotated seed batch doesn't grow unbounded. */
  shouldAutoRotate(usedRounds: number): boolean {
    return usedRounds >= MAX_ROUNDS_PER_SEED;
  }

  async listRevealed(limit = 20) {
    return this.prisma.aviatorFairnessSeed.findMany({
      where: { isActive: false },
      orderBy: { revealedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        serverSeed: true,
        serverSeedHash: true,
        clientSeed: true,
        startRoundNumber: true,
        endRoundNumber: true,
        startedAt: true,
        revealedAt: true,
        rotationReason: true,
      },
    });
  }

  currentPublic(): { serverSeedHash: string; clientSeed: string; seedId: string } | null {
    if (!this.active) return null;
    return {
      serverSeedHash: this.active.serverSeedHash,
      clientSeed: this.active.clientSeed,
      seedId: this.active.id,
    };
  }
}
