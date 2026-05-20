import { Module } from '@nestjs/common';
import { ResponsibleGamblingController } from './responsible-gambling.controller';
import { ResponsibleGamblingService } from './responsible-gambling.service';

/**
 * Responsible-gambling module — limits + cooldown + self-exclusion.
 * Exports the service so `BidsService` and `AuthService` can call
 * `assertCanBet()` / `assertCanLogin()` on the hot paths.
 */
@Module({
  controllers: [ResponsibleGamblingController],
  providers: [ResponsibleGamblingService],
  exports: [ResponsibleGamblingService],
})
export class ResponsibleGamblingModule {}
