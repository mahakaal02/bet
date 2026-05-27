import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FlagMode, Role } from '@prisma/client';
import { Perm } from './perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { AuditLogService } from '../foundation/audit-log.service';
import { FeatureFlagService } from '../foundation/feature-flags.service';

/**
 * Admin feature-flag API. Drives the `/feature-flags` page in the
 * admin SPA where operators flip the gates that gate every new
 * business feature (see Roadmap §1E).
 *
 *   GET   /admin/feature-flags         — list all rows
 *   PATCH /admin/feature-flags/:id     — { mode?, enabled?, roles?, rolloutPercent?, description? }
 *
 * Every PATCH writes an `AdminAuditLog` entry. The before/after
 * snapshots capture every field on the flag (not just changed
 * ones) so an "all-OFF" emergency state is faithfully reconstructible
 * from the log alone.
 *
 * Mode + value cross-checks (enforced in `validatePatch()`):
 *
 *   - BOOLEAN mode: `enabled` controls the answer. `roles` and
 *     `rolloutPercent` are ignored at evaluation time but the
 *     UI preserves them.
 *   - ROLE mode: at least one `Role` must be in the list, else
 *     the flag is a no-op for every user.
 *   - PERCENT mode: `rolloutPercent` must be in [0, 100].
 */

class UpdateFlagDto {
  @IsOptional() @IsEnum(FlagMode)
  mode?: FlagMode;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsArray() @IsEnum(Role, { each: true })
  roles?: Role[];

  @IsOptional() @IsInt() @Min(0) @Max(100)
  rolloutPercent?: number;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}

// PR-ARCH-AUDIT Stage C: migrated to @Perm(). Reads need
// feature_flag.view (AUDITOR gets this via '*.view' wildcard);
// writes need feature_flag.edit (only ADMIN by default, can be
// granted to operations roles later).
@Controller('admin/feature-flags')
export class FeatureFlagsController {
  constructor(
    private readonly flags: FeatureFlagService,
    private readonly audit: AuditLogService,
  ) {}

  @Perm('feature_flag.view')
  @Get()
  async list() {
    const rows = await this.flags.listFlags();
    return {
      items: rows.map((r) => ({
        id: r.id,
        description: r.description,
        mode: r.mode,
        enabled: r.enabled,
        roles: r.roles,
        rolloutPercent: r.rolloutPercent,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt.toISOString(),
        group: groupOf(r.id),
      })),
      // Static role list for the role-mode picker.
      roles: Object.values(Role),
      modes: Object.values(FlagMode),
    };
  }

  @Perm('feature_flag.edit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFlagDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: {
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
  ) {
    const before = await this.flags.getFlag(id);
    if (!before) {
      throw new NotFoundException(
        `flag ${id} not found — flags must be seeded via a migration before they can be edited`,
      );
    }

    const merged = {
      mode: dto.mode ?? before.mode,
      enabled: dto.enabled ?? before.enabled,
      roles: dto.roles ?? before.roles,
      rolloutPercent: dto.rolloutPercent ?? before.rolloutPercent,
    };
    const err = validatePatch(merged);
    if (err) throw new BadRequestException(err);

    const updated = await this.flags.setFlag(
      id,
      {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        mode: merged.mode,
        enabled: merged.enabled,
        roles: merged.roles,
        rolloutPercent: merged.rolloutPercent,
      },
      actor.id,
    );

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      action: 'feature_flag.update',
      targetType: 'FeatureFlag',
      targetId: id,
      before: {
        mode: before.mode,
        enabled: before.enabled,
        roles: before.roles,
        rolloutPercent: before.rolloutPercent,
        description: before.description,
      },
      after: {
        mode: updated.mode,
        enabled: updated.enabled,
        roles: updated.roles,
        rolloutPercent: updated.rolloutPercent,
        description: updated.description,
      },
      ipAddress: extractIp(req),
      userAgent: pickHeader(req, 'user-agent') ?? undefined,
    });

    return {
      id: updated.id,
      description: updated.description,
      mode: updated.mode,
      enabled: updated.enabled,
      roles: updated.roles,
      rolloutPercent: updated.rolloutPercent,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

function validatePatch(merged: {
  mode: FlagMode;
  enabled: boolean;
  roles: Role[];
  rolloutPercent: number;
}): string | null {
  if (merged.mode === FlagMode.ROLE && merged.roles.length === 0) {
    return 'ROLE-mode flags need at least one role — leaving it empty would make the flag a no-op for everyone';
  }
  if (
    merged.mode === FlagMode.PERCENT &&
    (merged.rolloutPercent < 0 || merged.rolloutPercent > 100)
  ) {
    return 'rolloutPercent must be between 0 and 100';
  }
  return null;
}

function groupOf(key: string): string {
  const idx = key.indexOf('.');
  return idx >= 0 ? key.slice(0, idx) : 'other';
}

function extractIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim();
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  return req.ip;
}

function pickHeader(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
