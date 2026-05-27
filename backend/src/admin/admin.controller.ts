import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AuctionsService } from '../auctions/auctions.service';
import { CoinSettingsService } from '../coins/coin-settings.service';
import { CoinPacksService } from '../coin-packs/coin-packs.service';
import { AviatorService } from '../aviator/aviator.service';
import { AviatorChatService } from '../aviator/chat.service';
import { FairnessStore } from '../aviator/fairness-store';
import { CrashDistributionService } from '../aviator/crash/crash-distribution.service';
import {
  DEFAULT_PAYOUT_CAP_COINS,
  DEFAULT_PAYOUT_CAP_ENABLED,
  PAYOUT_CAP_KEY_ENABLED,
  PAYOUT_CAP_KEY_MAX_COINS,
} from '../aviator/payout-cap';
import { SettingType } from '@prisma/client';
import { SettingsService } from '../foundation/settings.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { requestMeta } from '../foundation/request-meta';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { BadRequestException } from '@nestjs/common';
import { Perm } from './perms.guard';
import {
  CreateAuctionDto,
  CreateCoinPackDto,
  UpdateAuctionDto,
  UpdateCoinSettingsDto,
  UpsertCoinPackDto,
} from './dto/admin.dto';

type ReqLike = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

/**
 * Admin omnibus controller. Historically gated by the legacy
 * AdminGuard (User.isAdmin bit only) which made all-or-nothing
 * access the only granularity. PR-ARCH-AUDIT Stage C migrated every
 * endpoint to @Perm() so non-admin roles (FINANCE, MODERATOR,
 * SUPPORT, AUDITOR) can each see/touch only the slice they need.
 *
 * Legacy `isAdmin: true` accounts still get through because
 * PermsGuard backstops them on line 61 of perms.guard.ts — that
 * keeps the existing admin login flow unchanged.
 *
 * @Perm() stacks JwtAuthGuard + PermsGuard + permission metadata,
 * so no class-level @UseGuards is needed.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly coinSettings: CoinSettingsService,
    private readonly coinPacks: CoinPacksService,
    private readonly aviator: AviatorService,
    private readonly aviatorChat: AviatorChatService,
    private readonly fairness: FairnessStore,
    private readonly crashEngine: CrashDistributionService,
    private readonly settings: SettingsService,
    // PR-ARCH-AUDIT Stage D — explicit audit writes on every
    // mutation. There is no interceptor (despite an earlier
    // docstring claiming so); each handler records its own diff.
    private readonly audit: AuditLogService,
  ) {}

  private actorMeta(actor: AuthedUser, req: ReqLike) {
    return {
      actorId: actor.id,
      actorEmail: actor.email ?? actor.username,
      ...requestMeta(req),
    };
  }

  @Perm('coin_settings.view')
  @Get('coin-settings')
  getCoinSettings() {
    return this.coinSettings.get();
  }

  @Perm('coin_settings.edit')
  @Patch('coin-settings')
  async updateCoinSettings(
    @Body() dto: UpdateCoinSettingsDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const before = await this.coinSettings.get();
    const updated = await this.coinSettings.update(dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'coin_settings.update',
      targetType: 'CoinSettings',
      targetId: 'singleton',
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  @Perm('coin_pack.view')
  @Get('coin-packs')
  listCoinPacks() {
    return this.coinPacks.listAll();
  }

  @Perm('coin_pack.edit')
  @Post('coin-packs')
  async createCoinPack(
    @Body() dto: CreateCoinPackDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const created = await this.coinPacks.create(dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'coin_pack.create',
      targetType: 'CoinPack',
      targetId: (created as { id: string }).id,
      after: created as unknown as Record<string, unknown>,
    });
    return created;
  }

  @Perm('coin_pack.edit')
  @Patch('coin-packs/:id')
  async updateCoinPack(
    @Param('id') id: string,
    @Body() dto: UpsertCoinPackDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const updated = await this.coinPacks.update(id, dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'coin_pack.update',
      targetType: 'CoinPack',
      targetId: id,
      after: { ...(dto as unknown as Record<string, unknown>) },
    });
    return updated;
  }

  @Perm('coin_pack.edit')
  @Delete('coin-packs/:id')
  async deleteCoinPack(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.coinPacks.delete(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'coin_pack.delete',
      targetType: 'CoinPack',
      targetId: id,
    });
    return result;
  }

  @Perm('auction.edit')
  @Post('auctions')
  async createAuction(
    @Body() dto: CreateAuctionDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const created = await this.auctions.create(dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'auction.create',
      targetType: 'Auction',
      targetId: (created as { id: string }).id,
      after: { ...(dto as unknown as Record<string, unknown>) },
    });
    return created;
  }

  @Perm('auction.edit')
  @Patch('auctions/:id')
  async updateAuction(
    @Param('id') id: string,
    @Body() dto: UpdateAuctionDto,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const updated = await this.auctions.update(id, dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'auction.update',
      targetType: 'Auction',
      targetId: id,
      after: { ...(dto as unknown as Record<string, unknown>) },
    });
    return updated;
  }

  @Perm('auction.edit')
  @Delete('auctions/:id')
  async deleteAuction(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.auctions.delete(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'auction.delete',
      targetType: 'Auction',
      targetId: id,
    });
    return result;
  }

  @Perm('auction.edit')
  @Post('auctions/:id/start')
  async startAuction(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.auctions.startNow(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'auction.start',
      targetType: 'Auction',
      targetId: id,
    });
    return result;
  }

  @Perm('auction.edit')
  @Post('auctions/:id/close')
  async closeAuction(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.auctions.close(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'auction.close',
      targetType: 'Auction',
      targetId: id,
    });
    return result;
  }

  // Exhaustive per-bid inspector for the auction admin "Bidding" view.
  // Returns one row per bid with both the at-post classification and the
  // current classification — ringmaster phantoms surface as @ringmaster.
  @Perm('auction.bids_view')
  @Get('auctions/:id/bids')
  listAuctionBids(@Param('id') id: string) {
    return this.auctions.listBids(id);
  }

  // ─── Withdrawals ─────────────────────────────────────────────────────────
  // Moved to Bet's admin (canonical wallet). See `/admin/withdrawals` on
  // the Bet host — that's where pending payouts surface, with the per-user
  // audit page showing all coin flow + IP overlap warnings.

  // Live snapshot of the current Aviator round (phase, bettor count,
  // total stake on this round). Drives the live-tile row on the admin
  // analytics page.
  @Perm('aviator.view')
  @Get('aviator/current')
  aviatorCurrentRound() {
    return this.aviator.adminCurrentRound();
  }

  // Per-user breakdown of bets on the current round. Drill-down from
  // the "Coins riding on this round" tile.
  @Perm('aviator.view')
  @Get('aviator/current/bets')
  aviatorCurrentRoundBets() {
    return this.aviator.adminCurrentRoundBets();
  }

  // Per-round P&L for the historical round log. Each row: round number,
  // stake, payout, house P/L, bettor count. Cursor paginate by
  // `before=<roundNumber>` to walk older.
  @Perm('aviator.view')
  @Get('aviator/rounds-pnl')
  aviatorRoundsPnl(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const n = Math.min(500, Math.max(1, Number(limit) || 50));
    const beforeNum = before ? Number(before) : undefined;
    return this.aviator.adminRoundsPnl(
      n,
      Number.isFinite(beforeNum) ? beforeNum : undefined,
    );
  }

  // Day / month / fiscal-year (Indian, Apr–Mar) rollup of stake +
  // payout + house P/L. Used for the finance summary tabs.
  @Perm('aviator.view')
  @Get('aviator/finance-rollup')
  aviatorFinanceRollup(
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const p = period === 'month' ? 'month' : period === 'fy' ? 'fy' : 'day';
    const n = Math.min(120, Math.max(1, Number(limit) || 30));
    return this.aviator.adminFinanceRollup(p, n);
  }

  // Admin knobs for Aviator: (1) global max-payout ceiling, (2) one-shot
  // forced-payout override for the next round. See `AviatorSettings` model.
  @Perm('aviator.view')
  @Get('aviator/settings')
  aviatorSettings() {
    return this.aviator.getAdminSettings();
  }

  @Perm('aviator.settings_edit')
  @Patch('aviator/settings')
  async updateAviatorSettings(
    @Body() dto: { maxPayout?: string | null; forcedNextPayout?: string | null },
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const before = await this.aviator.getAdminSettings();
    const updated = await this.aviator.updateAdminSettings(dto);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'aviator.settings_update',
      targetType: 'AviatorSettings',
      targetId: '1',
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  // ── Crash-engine controls ────────────────────────────────────────
  // The four operator-facing knobs for the heavy-tail crash engine.
  // Reads return a live snapshot (mode in use, exposure factor, bucket
  // histogram). Writes go through SettingsService so they're audited
  // via SystemSettingHistory exactly like the generic Settings UI.

  @Perm('aviator.view')
  @Get('aviator/crash-engine')
  async getCrashEngine() {
    // Force a config refresh so the snapshot reflects any setting
    // edit from the generic /settings page since the last round.
    await this.crashEngine.refreshConfig();
    return this.crashEngine.snapshot();
  }

  @Perm('aviator.crash_engine_edit')
  @Patch('aviator/crash-engine')
  async updateCrashEngine(
    @Body()
    dto: {
      engine?: 'legacy' | 'heavytail';
      rtp?: number;
      mode?: 'balanced' | 'fast_loss' | 'streamer';
      adaptiveEnabled?: boolean;
    },
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    // Validate up front so a misclicked admin can't write garbage
    // into SystemSetting and then have the engine clamp it silently.
    if (dto.engine !== undefined && dto.engine !== 'legacy' && dto.engine !== 'heavytail') {
      throw new BadRequestException('engine must be "legacy" or "heavytail"');
    }
    if (dto.mode !== undefined && !['balanced', 'fast_loss', 'streamer'].includes(dto.mode)) {
      throw new BadRequestException('mode must be balanced | fast_loss | streamer');
    }
    if (dto.rtp !== undefined) {
      if (!Number.isFinite(dto.rtp) || dto.rtp < 0.5 || dto.rtp > 0.999) {
        throw new BadRequestException('rtp must be a finite number in [0.5, 0.999]');
      }
    }
    if (dto.adaptiveEnabled !== undefined && typeof dto.adaptiveEnabled !== 'boolean') {
      throw new BadRequestException('adaptiveEnabled must be boolean');
    }

    if (dto.engine !== undefined) {
      await this.settings.set('aviator.crash.engine', dto.engine, SettingType.STRING, actor.id);
    }
    if (dto.rtp !== undefined) {
      await this.settings.set('aviator.crash.rtp', dto.rtp, SettingType.FLOAT, actor.id);
    }
    if (dto.mode !== undefined) {
      await this.settings.set('aviator.crash.mode', dto.mode, SettingType.STRING, actor.id);
    }
    if (dto.adaptiveEnabled !== undefined) {
      await this.settings.set(
        'aviator.crash.adaptive_enabled',
        dto.adaptiveEnabled,
        SettingType.BOOL,
        actor.id,
      );
    }

    await this.crashEngine.refreshConfig();
    const snapshot = this.crashEngine.snapshot();
    // SettingsService.set() already writes SystemSettingHistory rows
    // for each individual key. We additionally record one AdminAuditLog
    // entry per operator action so the admin forensic timeline lists
    // a single "crash engine updated" row instead of forcing an auditor
    // to reconstruct the intent from 1–4 SystemSettingHistory rows.
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'aviator.crash_engine_update',
      targetType: 'CrashEngine',
      targetId: 'singleton',
      after: { ...(dto as unknown as Record<string, unknown>) },
    });
    return snapshot;
  }

  // ── Payout-cap (PR-AVIATOR-PAYOUT-CAP) ────────────────────────────
  // Per-bet settlement-side ceiling, distinct from
  // `AviatorSettings.maxPayout` which clips the crash multiplier itself.
  // Storage is SystemSetting (audit-logged via SettingsService.set)
  // so admin edits show up in SystemSettingHistory like the crash-
  // engine knobs.

  @Perm('aviator.view')
  @Get('aviator/payout-cap')
  async getPayoutCap() {
    const enabled = await this.settings.getBool(
      PAYOUT_CAP_KEY_ENABLED,
      DEFAULT_PAYOUT_CAP_ENABLED,
    );
    const maxCoins = await this.settings.getInt(
      PAYOUT_CAP_KEY_MAX_COINS,
      DEFAULT_PAYOUT_CAP_COINS,
    );
    return { enabled, maxCoins };
  }

  @Perm('aviator.payout_cap_edit')
  @Patch('aviator/payout-cap')
  async updatePayoutCap(
    @Body() dto: { enabled?: boolean; maxCoins?: number | null },
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    // Validate up front so a misclicked admin can't write garbage
    // into SystemSetting and then have loadCapConfig silently
    // coerce it back to the default with no audit trail.
    if (
      dto.enabled !== undefined &&
      typeof dto.enabled !== 'boolean'
    ) {
      throw new BadRequestException('enabled must be a boolean');
    }
    if (dto.maxCoins !== undefined && dto.maxCoins !== null) {
      if (
        !Number.isFinite(dto.maxCoins) ||
        !Number.isInteger(dto.maxCoins) ||
        dto.maxCoins < 1
      ) {
        throw new BadRequestException(
          'maxCoins must be a positive integer (or null to reset to default)',
        );
      }
    }

    if (dto.enabled !== undefined) {
      await this.settings.set(
        PAYOUT_CAP_KEY_ENABLED,
        dto.enabled,
        SettingType.BOOL,
        actor.id,
      );
    }
    if (dto.maxCoins !== undefined) {
      // null → reset to default. We write the default explicitly
      // (rather than DELETE-ing the row) so the audit history
      // shows the operator's intent + the next reader sees the
      // canonical default rather than the env-var fallback.
      const value =
        dto.maxCoins === null ? DEFAULT_PAYOUT_CAP_COINS : dto.maxCoins;
      await this.settings.set(
        PAYOUT_CAP_KEY_MAX_COINS,
        value,
        SettingType.INT,
        actor.id,
      );
    }
    const after = await this.getPayoutCap();
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'aviator.payout_cap_update',
      targetType: 'PayoutCap',
      targetId: 'singleton',
      after: { ...(dto as unknown as Record<string, unknown>) },
    });
    return after;
  }

  @Perm('aviator.view')
  @Get('aviator/rounds')
  aviatorRounds(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    const beforeNum = before ? Number(before) : undefined;
    return this.aviator.adminRoundLog(n, Number.isFinite(beforeNum) ? beforeNum : undefined);
  }

  @Perm('aviator.view')
  @Get('aviator/analytics')
  aviatorAnalytics(@Query('hours') hours?: string) {
    const h = Math.min(720, Math.max(1, Number(hours) || 24));
    return this.aviator.adminAnalytics(h);
  }

  @Perm('aviator.view')
  @Get('aviator/seeds')
  aviatorSeeds(@Query('limit') limit?: string) {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    return Promise.all([this.fairness.currentPublic(), this.fairness.listRevealed(n)]).then(
      ([current, revealed]) => ({ current, revealed }),
    );
  }

  @Perm('aviator.view')
  @Get('aviator/chat')
  aviatorChatList(@Query('limit') limit?: string) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.aviatorChat.adminList(n);
  }

  @Perm('aviator.chat_moderate')
  @Delete('aviator/chat/:id')
  async aviatorChatDelete(
    @Param('id') id: string,
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.aviatorChat.deleteMessage(id);
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'aviator.chat_delete',
      targetType: 'AviatorChat',
      targetId: id,
    });
    return result;
  }

  @Perm('aviator.seed_rotate')
  @Post('aviator/seed/rotate')
  async rotateAviatorSeed(
    @CurrentUser() actor: AuthedUser,
    @Req() req: ReqLike,
  ) {
    const result = await this.aviator.rotateSeed('admin');
    // Seed rotation is a fairness-critical event. The seed reveal is
    // already broadcast via SEED_ROTATED on the gateway and recorded
    // by the fairness store. We additionally log it to AdminAuditLog
    // so an auditor can answer "which operator rotated the seed and
    // when?" without joining against the fairness table.
    await this.audit.record({
      ...this.actorMeta(actor, req),
      action: 'aviator.seed_rotate',
      targetType: 'AviatorFairnessSeed',
      targetId: result.revealed.id,
      after: {
        revealedId: result.revealed.id,
        revealedHash: result.revealed.serverSeedHash,
        nextId: result.next.id,
        nextHash: result.next.serverSeedHash,
      },
    });
    return {
      revealed: {
        id: result.revealed.id,
        serverSeed: result.revealed.serverSeed,
        serverSeedHash: result.revealed.serverSeedHash,
        startRoundNumber: result.revealed.startRoundNumber,
        endRoundNumber: result.revealed.endRoundNumber,
        revealedAt: result.revealed.revealedAt,
      },
      next: {
        id: result.next.id,
        serverSeedHash: result.next.serverSeedHash,
        clientSeed: result.next.clientSeed,
      },
    };
  }
}
