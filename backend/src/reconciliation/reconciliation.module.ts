import { Module, Provider } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { BetWalletModule } from '../bet-wallet/bet-wallet.module';
import { BetWalletService } from '../bet-wallet/bet-wallet.service';
import { ReconciliationService, BalanceFetcher } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationWorker } from './reconciliation.worker';

/**
 * Reconciliation wiring.
 *
 * `BalanceFetcher` is the swap point: the production binding calls
 * `BetWalletService.balance(userId)`; tests bind their own mock.
 * Wrapping it in an interface (rather than injecting BetWalletService
 * directly) keeps the service unit-testable without an HTTP boundary
 * and lets us swap in a batch endpoint later without changing the
 * service.
 */

const balanceFetcherProvider: Provider = {
  provide: ReconciliationService.BALANCE_FETCHER,
  inject: [BetWalletService],
  useFactory: (bet: BetWalletService): BalanceFetcher => ({
    fetch: (userId: string) => bet.balance(userId),
  }),
};

@Module({
  imports: [PrismaModule, FoundationModule, BetWalletModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, balanceFetcherProvider, ReconciliationWorker],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
