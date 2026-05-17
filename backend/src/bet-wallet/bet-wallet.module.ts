import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BetWalletService } from './bet-wallet.service';

/**
 * Shared HTTP client for Bet's canonical wallet. Imported by any module
 * whose business logic moves coins (Bids, Payments, Aviator — when that
 * lands).
 */
@Module({
  providers: [PrismaService, BetWalletService],
  exports: [BetWalletService],
})
export class BetWalletModule {}
