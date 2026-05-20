import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileAdminController } from './profile-admin.controller';
import { ProfileService } from './profile.service';

/**
 * Profile module — `/me/profile` GET + PATCH (display name) + the
 * avatar upload endpoint, plus the PR-PROFILE-2 admin moderation
 * controller at `/admin/profile/*`.
 */
@Module({
  controllers: [ProfileController, ProfileAdminController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
