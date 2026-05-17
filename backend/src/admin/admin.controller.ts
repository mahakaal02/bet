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

  // ─── Withdrawals ─────────────────────────────────────────────────────────
  // Moved to Bet's admin (canonical wallet). See `/admin/withdrawals` on
  // the Bet host — that's where pending payouts surface, with the per-user
  // audit page showing all coin flow + IP overlap warnings.

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
