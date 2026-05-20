import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SettingType, SystemSetting } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { AuditLogService } from '../foundation/audit-log.service';
import { SettingsService } from '../foundation/settings.service';

/**
 * Admin runtime-settings API. Drives the `/settings` page in the
 * admin SPA where operators edit the catalog rows defined in
 * Migration `20260520180000_settings_catalog/` — see Roadmap §1F.
 *
 *   GET   /admin/settings                  — list all rows + grouping
 *   GET   /admin/settings/:key/history     — last N history rows
 *   PATCH /admin/settings/:key             — { value, reason? }
 *
 * Every PATCH writes BOTH a `SystemSettingHistory` row (forensic
 * trail of value changes) AND an `AdminAuditLog` row (forensic
 * trail of admin actions). They serve different audit lenses —
 * the history table answers "what was this value last week?", the
 * audit log answers "what did this admin touch yesterday?".
 *
 * Validation: the incoming `value` is coerced against the row's
 * declared `valueType`. Mismatched shapes (e.g. string-where-INT)
 * 400 with a structured error so the admin UI can render an
 * inline form error rather than a toast.
 *
 * Two-admin approval for `CRITICAL_KEYS` (wallet caps, KYC limits)
 * is deferred to a follow-up PR. For now the controller surfaces
 * the `critical: true` hint in the GET payload so the admin UI
 * can present a stronger confirmation modal.
 */

const CRITICAL_KEYS = new Set<string>([
  'wallet.withdraw_min_coins',
  'wallet.topup_min_coins',
  'wallet.signup_bonus_coins',
  'kyc.tier1_daily_withdraw_max_coins',
  'kyc.tier2_daily_withdraw_max_coins',
  'kyc.tier3_daily_withdraw_max_coins',
]);

/**
 * Group prefix → display label. Keys are matched by the substring
 * before the first dot. Anything unmatched is bucketed under
 * "Other" so the UI never loses a row.
 */
const GROUP_LABELS: Record<string, string> = {
  wallet: 'Wallet & payments',
  aviator: 'Aviator',
  auctions: 'Auctions',
  referral: 'Referral programme',
  rg: 'Responsible gambling',
  kyc: 'KYC tiers',
  notifications: 'Notifications',
  outbox: 'Outbox',
  watchlist: 'Watchlist',
};

class UpdateSettingDto {
  // `value` is untyped — class-validator can't introspect "INT vs
  // STRING vs JSON" at decoration time, so we coerce + check at
  // runtime against the row's declared type below.
  value!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async list() {
    const rows = await this.settings.list();
    return {
      groups: this.groupRows(rows),
      items: rows.map((r) => ({
        key: r.key,
        value: r.value,
        valueType: r.valueType,
        description: r.description,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt.toISOString(),
        critical: CRITICAL_KEYS.has(r.key),
        group: groupOf(r.key),
        groupLabel: GROUP_LABELS[groupOf(r.key)] ?? 'Other',
      })),
    };
  }

  @Get(':key/history')
  async history(
    @Param('key') key: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));
    const rows = await this.settings.history(key, limit);
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        before: r.before,
        after: r.after,
        changedBy: r.changedBy,
        changedAt: r.changedAt.toISOString(),
      })),
    };
  }

  // Throttled so a mis-clicking admin (or a script) can't thrash
  // wallet caps. 6/min/admin is plenty for human-paced edits.
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: {
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
  ) {
    const before = await this.findExisting(key);
    const coerced = coerceForType(dto.value, before.valueType);
    if (coerced.error) {
      throw new BadRequestException(coerced.error);
    }

    const updated = await this.settings.set(
      key,
      coerced.value,
      before.valueType,
      actor.id,
      before.description ?? undefined,
    );

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      action: 'settings.update',
      targetType: 'SystemSetting',
      targetId: key,
      before: { value: before.value, valueType: before.valueType },
      after: {
        value: updated.value,
        valueType: updated.valueType,
        reason: dto.reason ?? null,
      },
      ipAddress: extractIp(req),
      userAgent: pickHeader(req, 'user-agent') ?? undefined,
    });

    return {
      key: updated.key,
      value: updated.value,
      valueType: updated.valueType,
      description: updated.description,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt.toISOString(),
      critical: CRITICAL_KEYS.has(updated.key),
    };
  }

  private async findExisting(key: string): Promise<SystemSetting> {
    const rows = await this.settings.list();
    const row = rows.find((r) => r.key === key);
    if (!row) {
      throw new NotFoundException(
        `unknown setting "${key}" — only catalogued settings are editable`,
      );
    }
    return row;
  }

  private groupRows(rows: SystemSetting[]) {
    const groups = new Map<string, { label: string; keys: string[] }>();
    for (const r of rows) {
      const g = groupOf(r.key);
      const label = GROUP_LABELS[g] ?? 'Other';
      if (!groups.has(g)) groups.set(g, { label, keys: [] });
      groups.get(g)!.keys.push(r.key);
    }
    return Array.from(groups.entries()).map(([id, g]) => ({
      id,
      label: g.label,
      keys: g.keys,
    }));
  }
}

function groupOf(key: string): string {
  const idx = key.indexOf('.');
  return idx >= 0 ? key.slice(0, idx) : 'other';
}

/**
 * Validate + coerce the incoming JSON body field against the
 * declared SettingType. Returns either `{value: coerced}` or
 * `{error: "human message"}`. Never throws — the caller decides
 * how to surface validation failures.
 */
function coerceForType(
  raw: unknown,
  type: SettingType,
): { value?: unknown; error?: string } {
  if (raw === undefined || raw === null) {
    return { error: 'value is required' };
  }
  switch (type) {
    case SettingType.INT: {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
        return { error: 'value must be an integer' };
      }
      return { value: n };
    }
    case SettingType.FLOAT: {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return { error: 'value must be a finite number' };
      }
      return { value: n };
    }
    case SettingType.STRING:
      if (typeof raw !== 'string') {
        return { error: 'value must be a string' };
      }
      return { value: raw };
    case SettingType.BOOL: {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 1) return { value: true };
      if (raw === 'false' || raw === 0) return { value: false };
      return { error: 'value must be true or false' };
    }
    case SettingType.JSON:
      // JSON values pass through — admin UI is responsible for shape.
      return { value: raw };
    default:
      return { error: `unknown setting type ${type}` };
  }
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
