import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateDisplayName } from './profile-validation';

/**
 * Profile customisation (Roadmap §F-USER-5).
 *
 * Display name + avatar key edits. Rate-limited to one display-name
 * change per 30 days (regulatory + anti-spoof). Every change writes a
 * `UserProfileHistory` row for the admin moderation queue
 * (PR-PROFILE-2) and for the user's own forensic visibility.
 *
 * Avatar pipeline (resize, EXIF strip, virus scan, S3) is deferred to
 * the storage-abstraction PR (Roadmap §1H). For now the controller
 * accepts a multipart upload and stores it under `/uploads/avatars/`
 * — the file key is what we persist in `User.avatarKey`. The full
 * pipeline drops in behind the same controller signature later.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);
  private static readonly RENAME_COOLDOWN_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarKey: true,
      },
    });
    if (!user) throw new NotFoundException('user not found');

    const earliestRename = await this.earliestNextRename(userId);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      avatarUrl: user.avatarKey ? `/uploads/${user.avatarKey}` : null,
      renameAvailableAt: earliestRename?.toISOString() ?? null,
    };
  }

  async setDisplayName(
    userId: string,
    nextName: string,
  ): Promise<{ displayName: string }> {
    const validation = validateDisplayName(nextName);
    if (!validation.ok) {
      throw new BadRequestException(validation.reason);
    }
    const trimmed = nextName.trim();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true },
    });
    if (!user) throw new NotFoundException('user not found');

    if (user.displayName === trimmed) {
      // No-op — don't bump the rate-limit window for a typo.
      return { displayName: trimmed };
    }

    const earliest = await this.earliestNextRename(userId);
    if (earliest && earliest.getTime() > Date.now()) {
      throw new ForbiddenException(
        `Display name changes are limited to one every ${ProfileService.RENAME_COOLDOWN_DAYS} days. Next change available ${earliest.toISOString()}.`,
      );
    }

    // Uniqueness check against existing displayName values. Username
    // collisions are already prevented by the unique constraint on
    // User.username; displayName isn't a primary identifier but we
    // still don't want @alice and @bob both showing as "Alice".
    const collision = await this.prisma.user.findFirst({
      where: {
        displayName: { equals: trimmed, mode: 'insensitive' },
        NOT: { id: userId },
      },
      select: { id: true },
    });
    if (collision) {
      throw new ConflictException('That display name is already taken.');
    }

    // Snapshot the old value BEFORE the update call — the array
    // form of $transaction invokes its elements left-to-right, so
    // a Prisma client that returns the same object reference (or a
    // mock that does) would otherwise leak the post-update value
    // into the history row's `before` field. Same aliasing trap
    // found + fixed in PR-ADDRESS-1.
    const previousName = user.displayName;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { displayName: trimmed },
      }),
      this.prisma.userProfileHistory.create({
        data: {
          userId,
          field: 'displayName',
          before: previousName,
          after: trimmed,
        },
      }),
    ]);

    return { displayName: trimmed };
  }

  /**
   * Persist a new avatar key. The actual upload happens in the
   * controller (multipart-handled by Multer) and produces a stable
   * `<uuid>.<ext>` filename; this method just records that filename
   * on `User.avatarKey` and writes a history row.
   *
   * No cooldown on avatar changes — users can iterate freely.
   * Returns the public URL so the UI can swap the image immediately.
   */
  async setAvatarKey(userId: string, avatarKey: string) {
    const trimmed = avatarKey.trim();
    // Allow nested path segments (`avatars/<userId>/<uuid>.ext`).
    // Reject directory traversal (`..`) — the regex forbids it via
    // the explicit charset. Image extensions limited to jpg/png/webp/gif.
    if (!/^avatars(?:\/[a-zA-Z0-9_-]+)+\.(?:jpe?g|png|webp|gif)$/i.test(trimmed)) {
      throw new BadRequestException(
        'Invalid avatar key — must be a relative path under avatars/',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarKey: true },
    });
    if (!user) throw new NotFoundException('user not found');
    if (user.avatarKey === trimmed) {
      return {
        avatarKey: trimmed,
        avatarUrl: `/uploads/${trimmed}`,
      };
    }

    const previousKey = user.avatarKey;          // snapshot for history row

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { avatarKey: trimmed },
      }),
      this.prisma.userProfileHistory.create({
        data: {
          userId,
          field: 'avatarKey',
          before: previousKey,
          after: trimmed,
        },
      }),
    ]);

    return {
      avatarKey: trimmed,
      avatarUrl: `/uploads/${trimmed}`,
    };
  }

  /**
   * Compute the earliest moment the user can rename next. Reads from
   * UserProfileHistory — the last `displayName` change row + cooldown.
   * Returns null when there's never been a rename (i.e. the cooldown
   * has never started).
   */
  private async earliestNextRename(userId: string): Promise<Date | null> {
    const last = await this.prisma.userProfileHistory.findFirst({
      where: { userId, field: 'displayName' },
      orderBy: { changedAt: 'desc' },
      select: { changedAt: true },
    });
    if (!last) return null;
    return new Date(
      last.changedAt.getTime() +
        ProfileService.RENAME_COOLDOWN_DAYS * 24 * 60 * 60_000,
    );
  }
}
