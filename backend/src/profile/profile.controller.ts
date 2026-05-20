import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { ProfileService } from './profile.service';

/**
 * Authenticated profile endpoints (Roadmap §F-USER-5).
 *
 *   GET   /me/profile               — profile + renameAvailableAt
 *   PATCH /me/profile               — { displayName }
 *   POST  /me/profile/avatar        — multipart 'file' field
 *
 * Avatar upload uses the existing Multer disk-storage shape (same as
 * the admin /uploads endpoint). Files land under
 * `<UPLOAD_DIR>/avatars/<userId>/<uuid>.<ext>` and the relative key
 * (`avatars/<userId>/<uuid>.<ext>`) is what we persist on
 * `User.avatarKey`. The full S3 + EXIF strip + resize pipeline lands
 * with the storage-abstraction PR (Roadmap §1H); this controller's
 * signature stays unchanged at that point.
 */

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;                // 4MB
const AVATAR_ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

class UpdateDisplayNameDto {
  @IsString() @Length(3, 40)
  displayName!: string;
}

interface MulterFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@UseGuards(JwtAuthGuard)
@Controller('me/profile')
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  async get(@CurrentUser() user: AuthedUser) {
    return this.service.getProfile(user.id);
  }

  @Throttle({ profile_rename: { limit: 5, ttl: 60_000 } })
  @Patch()
  async update(
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateDisplayNameDto,
  ) {
    return this.service.setDisplayName(user.id, dto.displayName);
  }

  @Throttle({ profile_avatar: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (req, _file, cb) => {
          const user = (req as { user?: AuthedUser }).user;
          if (!user) return cb(new Error('not authenticated'), '');
          const dir = join(UPLOAD_DIR, 'avatars', user.id);
          try {
            await mkdir(dir, { recursive: true });
            cb(null, dir);
          } catch (err) {
            cb(err as Error, '');
          }
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const ok =
          AVATAR_ALLOWED_EXT.has(ext) &&
          /^image\/(jpe?g|png|webp)$/i.test(file.mimetype);
        if (!ok) {
          return cb(
            new BadRequestException(
              'Avatar must be a JPEG, PNG, or WebP image',
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthedUser,
    @UploadedFile() file: MulterFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('No avatar file uploaded');
    }
    // Multer wrote the file under uploads/avatars/<userId>/<filename>.
    // The stored avatarKey is the path relative to UPLOAD_DIR so the
    // existing static-file route `/uploads/*` resolves it.
    const avatarKey = `avatars/${user.id}/${file.filename}`;
    return this.service.setAvatarKey(user.id, avatarKey);
  }
}
