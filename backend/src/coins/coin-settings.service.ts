import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CACHE_KEY = 'coin-settings:default';
const CACHE_TTL = 60; // seconds

export interface CoinSettings {
  inrPerCoin: string;
  defaultCoinsPerBid: number;
}

@Injectable()
export class CoinSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get(): Promise<CoinSettings> {
    const cached = await this.redis.io.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const row = await this.prisma.coinSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    const settings: CoinSettings = {
      inrPerCoin: row.inrPerCoin.toString(),
      defaultCoinsPerBid: row.defaultCoinsPerBid,
    };
    await this.redis.io.set(CACHE_KEY, JSON.stringify(settings), 'EX', CACHE_TTL);
    return settings;
  }

  async update(input: Partial<CoinSettings>) {
    const data: Record<string, unknown> = {};
    if (input.inrPerCoin !== undefined) data.inrPerCoin = input.inrPerCoin;
    if (input.defaultCoinsPerBid !== undefined) data.defaultCoinsPerBid = input.defaultCoinsPerBid;

    const row = await this.prisma.coinSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data },
    });
    await this.redis.io.del(CACHE_KEY);
    return {
      inrPerCoin: row.inrPerCoin.toString(),
      defaultCoinsPerBid: row.defaultCoinsPerBid,
    } satisfies CoinSettings;
  }
}
