import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Perm } from '../admin/perms.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { AuditLogService } from '../foundation/audit-log.service';
import { PricingService } from './pricing.service';
import { BASELINE_COUNTRY } from './pricing.config';
import {
  OverrideMultiplierDto,
  OverridePriceDto,
  RunSyncDto,
} from './dto/pricing.dto';

type ReqLike = { ip?: string; headers: Record<string, unknown> };

/**
 * Admin pricing surface — gated by the same @Perm() RBAC the rest of
 * the admin API uses. Two new permission slugs:
 *
 *   pricing.view  — read snapshots, rows, forex, ppp, history
 *   pricing.sync  — trigger a sync, publish, override prices
 *
 * Every mutating call writes an audit-log entry (who, when, what)
 * just like the coin-pack admin routes.
 */
@Controller('admin/pricing')
export class PricingAdminController {
  constructor(
    private readonly pricing: PricingService,
    private readonly audit: AuditLogService,
  ) {}

  private actorMeta(actor: AuthedUser, req: ReqLike) {
    return {
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      ipAddress: req.ip,
      userAgent: (req.headers['user-agent'] as string) ?? undefined,
    };
  }

  /** Yearly history list (newest first). */
  @Perm('pricing.view')
  @Get('snapshots')
  listSnapshots() {
    return this.pricing.listSnapshots();
  }

  /**
   * Live local-price preview for the coin-packs admin. Recomputes every
   * active pack's price for `?country=` from its current baseUsdPrice +
   * the active snapshot's forex/PPP — so newly-added packs preview
   * instantly, before a sync. Defaults to the US baseline.
   */
  @Perm('pricing.view')
  @Get('preview')
  preview(@Query('country') country?: string) {
    return this.pricing.previewLocalPrices(country ?? BASELINE_COUNTRY);
  }

  /** Full detail of one snapshot — rows, forex, ppp, store-tier hints. */
  @Perm('pricing.view')
  @Get('snapshots/:id')
  snapshotDetail(@Param('id') id: string) {
    return this.pricing.getSnapshotDetail(id);
  }

  /**
   * Manual trigger for the annual generation. Defaults to publishing
   * the current UTC year; pass `{ publish: false }` to stage a DRAFT
   * for review, or `{ year }` to (re)generate a specific year.
   */
  @Perm('pricing.sync')
  @Post('sync')
  async sync(
    @Body() dto: RunSyncDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.pricing.runAnnualPricingSync({
      year: dto.year,
      publish: dto.publish ?? true,
      generatedBy: actor.id,
    });
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'pricing.sync',
      targetType: 'PricingSnapshot',
      targetId: result.snapshotId,
      after: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  /** Publish a previously-generated DRAFT snapshot. */
  @Perm('pricing.sync')
  @Post('snapshots/:id/publish')
  async publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.pricing.publishSnapshot(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'pricing.publish',
      targetType: 'PricingSnapshot',
      targetId: id,
    });
    return result;
  }

  /** Override a single computed regional price. */
  @Perm('pricing.sync')
  @Patch('rows/:id')
  async overrideRow(
    @Param('id') id: string,
    @Body() dto: OverridePriceDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const row = await this.pricing.overrideRowPrice(id, dto.roundedFinalPrice);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'pricing.row_override',
      targetType: 'RegionalCoinPricing',
      targetId: id,
      after: { roundedFinalPrice: dto.roundedFinalPrice },
    });
    return row;
  }

  /** Override a PPP multiplier (on a draft, before re-running sync). */
  @Perm('pricing.sync')
  @Patch('ppp/:id')
  async overridePpp(
    @Param('id') id: string,
    @Body() dto: OverrideMultiplierDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const factor = await this.pricing.overridePppMultiplier(id, dto.multiplier);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'pricing.ppp_override',
      targetType: 'PppFactorSnapshot',
      targetId: id,
      after: { multiplier: dto.multiplier },
    });
    return factor;
  }
}
