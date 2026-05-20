import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { detectSuspiciousDisplayName, validateDisplayName } from './profile-validation';
import { ProfileReviewAction } from '@prisma/client';

/** Joined row shape for the admin moderation queue. */
export interface ProfileQueueRow {
  historyId: string;
  userId: string;
  username: string;
  email: string | null;
  currentDisplayName: string | null;
  field: string;
  before: string | null;
  after: string | null;
  flagReason: string | null;
  reviewAction: ProfileReviewAction;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  changedAt: Date;
}

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

    // PR-PROFILE-2: borderline-suspicious names get inserted with
    // reviewAction=PENDING so the admin queue surfaces them. The user
    // experience is unchanged — the name is accepted; the moderator
    // sees it after the fact and can KEPT_AS_IS or FORCED_RENAME.
    const flagReason = detectSuspiciousDisplayName(trimmed);

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
          flagReason: flagReason ?? null,
          reviewAction: flagReason ? ProfileReviewAction.PENDING : ProfileReviewAction.NONE,
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

  // ─── Admin moderation queue (PR-PROFILE-2) ────────────────────────

  /**
   * Paginated list of profile-history rows for the admin moderation
   * queue. Filterable by reviewAction (default PENDING).
   *
   * The returned shape carries the user's identity + current
   * displayName so the queue page can show "@alice changed to
   * 'Kalki Official' — does this need a forced rename?" without an
   * extra round-trip per row.
   */
  async listModerationQueue(input: {
    action?: 'PENDING' | 'KEPT_AS_IS' | 'FORCED_RENAME' | 'NONE';
    cursor?: string;
    limit?: number;
  }): Promise<{ items: ProfileQueueRow[]; nextCursor: string | null }> {
    const take = Math.min(50, Math.max(1, input.limit ?? 25));
    const action = (input.action ?? 'PENDING') as ProfileReviewAction;
    const rows = await this.prisma.userProfileHistory.findMany({
      where: { reviewAction: action },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      include: {
        user: { select: { id: true, username: true, email: true, displayName: true } },
      },
    });
    const items: ProfileQueueRow[] = rows.slice(0, take).map((r) => ({
      historyId: r.id,
      userId: r.user.id,
      username: r.user.username,
      email: r.user.email,
      currentDisplayName: r.user.displayName,
      field: r.field,
      before: r.before,
      after: r.after,
      flagReason: r.flagReason,
      reviewAction: r.reviewAction,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      reviewNotes: r.reviewNotes,
      changedAt: r.changedAt,
    }));
    const nextCursor = rows.length > take ? rows[take].id : null;
    return { items, nextCursor };
  }

  /**
   * Mark a flagged row as "looked at, it's fine". Just flips state
   * and writes the reviewer's id + notes. No change to the user's
   * displayName.
   */
  async keepAsIs(input: {
    reviewer: { id: string; email: string };
    historyId: string;
    notes?: string;
  }): Promise<{ historyId: string; reviewAction: ProfileReviewAction }> {
    const row = await this.requireHistory(input.historyId);
    await this.prisma.userProfileHistory.update({
      where: { id: input.historyId },
      data: {
        reviewAction: ProfileReviewAction.KEPT_AS_IS,
        reviewedAt: new Date(),
        reviewedBy: input.reviewer.id,
        reviewNotes: input.notes ?? null,
      },
    });
    return { historyId: row.id, reviewAction: ProfileReviewAction.KEPT_AS_IS };
  }

  /**
   * Forced rename — admin overrides the user's chosen name. We write
   * a NEW UserProfileHistory row (so the audit trail is intact) AND
   * close out the original flagged row by marking it FORCED_RENAME.
   *
   * Bypasses the 30-day rename cooldown that would normally apply
   * to the user themselves — admin actions aren't gated by user
   * cooldowns.
   */
  async forceRename(input: {
    reviewer: { id: string; email: string };
    historyId: string;
    newDisplayName: string;
    notes?: string;
  }): Promise<{ historyId: string; newDisplayName: string }> {
    const validation = validateDisplayName(input.newDisplayName);
    if (!validation.ok) {
      throw new BadRequestException(`forced rename rejected: ${validation.reason}`);
    }
    const trimmed = input.newDisplayName.trim();
    const row = await this.requireHistory(input.historyId);

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { displayName: true },
    });
    if (!user) throw new NotFoundException('user not found');
    const previousName = user.displayName;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { displayName: trimmed },
      }),
      this.prisma.userProfileHistory.create({
        data: {
          userId: row.userId,
          field: 'displayName',
          before: previousName,
          after: trimmed,
          flagReason: 'admin_forced_rename',
          reviewAction: ProfileReviewAction.NONE,
          reviewedBy: input.reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: input.notes ?? null,
        },
      }),
      this.prisma.userProfileHistory.update({
        where: { id: input.historyId },
        data: {
          reviewAction: ProfileReviewAction.FORCED_RENAME,
          reviewedAt: new Date(),
          reviewedBy: input.reviewer.id,
          reviewNotes: input.notes ?? null,
        },
      }),
    ]);

    return { historyId: input.historyId, newDisplayName: trimmed };
  }

  private async requireHistory(id: string) {
    const row = await this.prisma.userProfileHistory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('history row not found');
    return row;
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
