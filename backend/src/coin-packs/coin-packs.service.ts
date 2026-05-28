import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCoinPackInput {
  coins: number;
  /** USD anchor price; PPP derives every local price from this. */
  baseUsdPrice: string;
  active?: boolean;
  sortOrder?: number;
}

export interface UpdateCoinPackInput {
  coins?: number;
  baseUsdPrice?: string;
  active?: boolean;
  sortOrder?: number;
}

@Injectable()
export class CoinPacksService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.coinPack.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
    });
  }

  listAll() {
    return this.prisma.coinPack.findMany({
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
    });
  }

  async getOrThrow(id: string) {
    const pack = await this.prisma.coinPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('coin pack not found');
    return pack;
  }

  /**
   * Create a pack, enforcing ONE pack per coin amount. A coin count is
   * a single sellable offer, so adding a pack for N coins replaces any
   * existing pack(s) of N coins. The delete cascades the pack's
   * RegionalCoinPricing rows (FK onDelete: Cascade) and nulls any
   * historical PaymentOrder.coinPackId (nullable FK), so it's safe.
   */
  create(input: CreateCoinPackInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.coinPack.deleteMany({ where: { coins: input.coins } });
      return tx.coinPack.create({
        data: {
          coins: input.coins,
          baseUsdPrice: input.baseUsdPrice,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    });
  }

  update(id: string, input: UpdateCoinPackInput) {
    return this.prisma.coinPack.update({ where: { id }, data: input });
  }

  delete(id: string) {
    return this.prisma.coinPack.delete({ where: { id } });
  }
}
