import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCoinPackInput {
  coins: number;
  priceInr: string;
  active?: boolean;
  sortOrder?: number;
}

export interface UpdateCoinPackInput {
  coins?: number;
  priceInr?: string;
  active?: boolean;
  sortOrder?: number;
}

@Injectable()
export class CoinPacksService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.coinPack.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { priceInr: 'asc' }],
    });
  }

  listAll() {
    return this.prisma.coinPack.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceInr: 'asc' }],
    });
  }

  async getOrThrow(id: string) {
    const pack = await this.prisma.coinPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('coin pack not found');
    return pack;
  }

  create(input: CreateCoinPackInput) {
    return this.prisma.coinPack.create({
      data: {
        coins: input.coins,
        priceInr: input.priceInr,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  update(id: string, input: UpdateCoinPackInput) {
    return this.prisma.coinPack.update({ where: { id }, data: input });
  }

  delete(id: string) {
    return this.prisma.coinPack.delete({ where: { id } });
  }
}
