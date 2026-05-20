import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PromoCodesService } from './promo-codes.service';

class ValidateDto {
  @IsString() @Length(2, 32)
  code!: string;
  @IsOptional() @IsString()
  coinPackId?: string;
  @IsInt() @Min(1)
  basePaise!: number;
}

@UseGuards(JwtAuthGuard)
@Controller('me/promo-codes')
export class PromoCodesController {
  constructor(private readonly svc: PromoCodesService) {}

  /**
   * User-facing dry-run validation. Returns discount + final amount
   * or a structured error code the frontend can map to friendly
   * messages.
   *
   * Throttled tight — promo-code brute-forcing is a real concern.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('validate')
  validate(@CurrentUser() user: AuthedUser, @Body() dto: ValidateDto) {
    return this.svc.validate({
      code: dto.code,
      userId: user.id,
      coinPackId: dto.coinPackId,
      basePaise: dto.basePaise,
    });
  }
}
