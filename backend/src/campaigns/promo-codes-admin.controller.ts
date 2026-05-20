import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PromoCodeDiscountType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { PromoCodesService } from './promo-codes.service';

class CreatePromoDto {
  @IsString() @Length(4, 32) code!: string;
  @IsEnum(PromoCodeDiscountType) discountType!: PromoCodeDiscountType;
  @IsInt() @Min(1) discountValue!: number;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxUsesPerUser?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsArray() coinPackIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SetEnabledDto {
  @IsBoolean() @Transform(({ value }) => value === true || value === 'true')
  enabled!: boolean;
}

class ListQueryDto {
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enabled?: boolean;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/promo-codes')
export class PromoCodesAdminController {
  constructor(private readonly svc: PromoCodesService) {}

  @Get()
  @Perm('*')
  list(@Query() q: ListQueryDto) {
    return this.svc.list({
      enabled: q.enabled,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Post()
  @Perm('*')
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreatePromoDto) {
    return this.svc.create({
      adminId: user.id,
      adminEmail: user.email ?? '',
      code: dto.code,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      maxUses: dto.maxUses,
      maxUsesPerUser: dto.maxUsesPerUser,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      coinPackIds: dto.coinPackIds,
      notes: dto.notes,
    });
  }

  @HttpCode(200)
  @Post(':id/enabled')
  @Perm('*')
  setEnabled(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SetEnabledDto,
  ) {
    return this.svc.setEnabled({
      adminId: user.id,
      adminEmail: user.email ?? '',
      promoCodeId: id,
      enabled: dto.enabled,
    });
  }
}
