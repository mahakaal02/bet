import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Profile module — `/me/profile` GET + PATCH (display name) and the
 * avatar upload endpoint. Storage abstraction (S3 + EXIF strip +
 * resize pipeline) lands in a follow-up.
 */
@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
