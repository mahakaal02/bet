import { Module } from '@nestjs/common';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Account deletion + GDPR/DPDP data export.
 * Roadmap §F-USER-12 + §F-USER-2 (partial — data export only).
 */
@Module({
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
