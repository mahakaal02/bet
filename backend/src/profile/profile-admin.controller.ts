import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ProfileReviewAction } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { ProfileService } from './profile.service';

/**
 * Admin-side profile moderation (PR-PROFILE-2).
 *
 *   GET  /admin/profile/queue         — list pending flagged rows
 *   POST /admin/profile/:id/keep      — accept the user's name as-is
 *   POST /admin/profile/:id/rename    — force-rename to a new value
 *
 * Permission gate: `user.view` for the queue, `user.edit_display_name`
 * for the mutations. Both already exist on the MODERATOR role from
 * PR-MODERATOR-1 — no new RBAC migration needed.
 */

class KeepDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class RenameDto {
  @IsString() @Length(3, 40)
  newDisplayName!: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class QueueQueryDto {
  @IsOptional() @IsIn(['PENDING', 'KEPT_AS_IS', 'FORCED_RENAME', 'NONE'])
  action?: 'PENDING' | 'KEPT_AS_IS' | 'FORCED_RENAME' | 'NONE';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/profile')
export class ProfileAdminController {
  constructor(private readonly svc: ProfileService) {}

  @Get('queue')
  @Perm('user.view')
  async queue(@Query() q: QueueQueryDto) {
    const limit = q.limit ? Number(q.limit) : undefined;
    return this.svc.listModerationQueue({
      action: q.action ?? 'PENDING',
      cursor: q.cursor,
      limit,
    });
  }

  @Post(':id/keep')
  @Perm('user.edit_display_name')
  async keep(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: KeepDto,
  ) {
    return this.svc.keepAsIs({
      reviewer: { id: user.id, email: user.email ?? '' },
      historyId: id,
      notes: body.notes,
    });
  }

  @Post(':id/rename')
  @Perm('user.edit_display_name')
  async rename(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: RenameDto,
  ) {
    return this.svc.forceRename({
      reviewer: { id: user.id, email: user.email ?? '' },
      historyId: id,
      newDisplayName: body.newDisplayName,
      notes: body.notes,
    });
  }
}
