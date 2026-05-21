import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AuctionsService } from '../auctions/auctions.service';
import { CoinSettingsService } from '../coins/coin-settings.service';
import { CoinPacksService } from '../coin-packs/coin-packs.service';
import { AviatorService } from '../aviator/aviator.service';
import { AviatorChatService } from '../aviator/chat.service';
import { FairnessStore } from '../aviator/fairness-store';
import { CrashDistributionService } from '../aviator/crash/crash-distribution.service';
import { SettingType } from '@prisma/client';
import { SettingsService } from '../foundation/settings.service';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { BadRequestException } from '@nestjs/common';
import {
  CreateAuctionDto,
  CreateCoinPackDto,
  UpdateAuctionDto,
  UpdateCoinSettingsDto,
  UpsertCoinPackDto,
} from './dto/admin.dto';

@UseGuards(JwtAuthGuard, AdminGuard)
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
  ) {}

  @Get('coin-settings')
  getCoinSettings() {
    return this.coinSettings.get();
  }

  @Patch('coin-settings')
  updateCoinSettings(@Body() dto: UpdateCoinSettingsDto) {
    return this.coinSettings.update(dto);
  }

  @Get('coin-packs')
  listCoinPacks() {
    return this.coinPacks.listAll();
  }

  @Post('coin-packs')
  createCoinPack(@Body() dto: CreateCoinPackDto) {
    return this.coinPacks.create(dto);
  }

  @Patch('coin-packs/:id')
  updateCoinPack(@Param('id') id: string, @Body() dto: UpsertCoinPackDto) {
    return this.coinPacks.update(id, dto);
  }

  @Delete('coin-packs/:id')
  deleteCoinPack(@Param('id') id: string) {
    return this.coinPacks.delete(id);
  }

  @Post('auctions')
  createAuction(@Body() dto: CreateAuctionDto) {
    return this.auctions.create(dto);
  }

  @Patch('auctions/:id')
  updateAuction(@Param('id') id: string, @Body() dto: UpdateAuctionDto) {
    return this.auctions.update(id, dto);
  }

  @Delete('auctions/:id')
  deleteAuction(@Param('id') id: string) {
    return this.auctions.delete(id);
  }

  @Post('auctions/:id/start')
  startAuction(@Param('id') id: string) {
    return this.auctions.startNow(id);
  }

  @Post('auctions/:id/close')
  closeAuction(@Param('id') id: string) {
    return this.auctions.close(id);
  }

  // Exhaustive per-bid inspector for the auction admin "Bidding" view.
  // Returns one row per bid with both the at-post classification and the
  // current classification — ringmaster phantoms surface as @ringmaster.
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
  @Get('aviator/current')
  aviatorCurrentRound() {
    return this.aviator.adminCurrentRound();
  }

  // Per-user breakdown of bets on the current round. Drill-down from
  // the "Coins riding on this round" tile.
  @Get('aviator/current/bets')
  aviatorCurrentRoundBets() {
    return this.aviator.adminCurrentRoundBets();
  }

  // Per-round P&L for the historical round log. Each row: round number,
  // stake, payout, house P/L, bettor count. Cursor paginate by
  // `before=<roundNumber>` to walk older.
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
  @Get('aviator/settings')
  aviatorSettings() {
    return this.aviator.getAdminSettings();
  }

  @Patch('aviator/settings')
  updateAviatorSettings(
    @Body() dto: { maxPayout?: string | null; forcedNextPayout?: string | null },
  ) {
    return this.aviator.updateAdminSettings(dto);
  }

  // ── Crash-engine controls ────────────────────────────────────────
  // The four operator-facing knobs for the heavy-tail crash engine.
  // Reads return a live snapshot (mode in use, exposure factor, bucket
  // histogram). Writes go through SettingsService so they're audited
  // via SystemSettingHistory exactly like the generic Settings UI.

  @Get('aviator/crash-engine')
  async getCrashEngine() {
    // Force a config refresh so the snapshot reflects any setting
    // edit from the generic /settings page since the last round.
    await this.crashEngine.refreshConfig();
    return this.crashEngine.snapshot();
  }

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
    return this.crashEngine.snapshot();
  }

  @Get('aviator/rounds')
  aviatorRounds(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    const beforeNum = before ? Number(before) : undefined;
    return this.aviator.adminRoundLog(n, Number.isFinite(beforeNum) ? beforeNum : undefined);
  }

  @Get('aviator/analytics')
  aviatorAnalytics(@Query('hours') hours?: string) {
    const h = Math.min(720, Math.max(1, Number(hours) || 24));
    return this.aviator.adminAnalytics(h);
  }

  @Get('aviator/seeds')
  aviatorSeeds(@Query('limit') limit?: string) {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    return Promise.all([this.fairness.currentPublic(), this.fairness.listRevealed(n)]).then(
      ([current, revealed]) => ({ current, revealed }),
    );
  }

  @Get('aviator/chat')
  aviatorChatList(@Query('limit') limit?: string) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.aviatorChat.adminList(n);
  }

  @Delete('aviator/chat/:id')
  aviatorChatDelete(@Param('id') id: string) {
    return this.aviatorChat.deleteMessage(id);
  }

  @Post('aviator/seed/rotate')
  async rotateAviatorSeed() {
    const result = await this.aviator.rotateSeed('admin');
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
