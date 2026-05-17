import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CoinPacksService } from './coin-packs.service';

@UseGuards(JwtAuthGuard)
@Controller('coin-packs')
export class CoinPacksController {
  constructor(private readonly packs: CoinPacksService) {}

  @Get()
  list() {
    return this.packs.listActive();
  }
}
