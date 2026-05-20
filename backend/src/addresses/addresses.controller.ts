import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { AddressesService } from './addresses.service';

/**
 * Shipping-address endpoints (Roadmap §F-USER-6).
 *
 *   GET    /me/addresses          — list (default first, then most-recent)
 *   POST   /me/addresses          — create
 *   PATCH  /me/addresses/:id      — partial update
 *   POST   /me/addresses/:id/default — promote to default
 *   DELETE /me/addresses/:id      — soft delete (auto-promotes next-best
 *                                    default if this was the default)
 *
 * Validation lives in `AddressesService.validateInput` so it can be
 * unit-tested without a NestJS test harness. The DTOs here are
 * shape-only (lengths) — semantic checks (E.164, ISO2, India PIN)
 * are uniform between create and update.
 */

class AddressDto {
  @IsString() @Length(2, 100) fullName!: string;
  @IsString() @Length(8, 20) phoneE164!: string;
  @IsString() @Length(3, 200) line1!: string;
  @IsOptional() @IsString() @Length(0, 200) line2?: string | null;
  @IsString() @Length(2, 100) city!: string;
  @IsString() @Length(2, 64) state!: string;
  @IsString() @Length(3, 16) postalCode!: string;
  @IsString() @Length(2, 2) countryIso2!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class PartialAddressDto {
  @IsOptional() @IsString() @Length(2, 100) fullName?: string;
  @IsOptional() @IsString() @Length(8, 20) phoneE164?: string;
  @IsOptional() @IsString() @Length(3, 200) line1?: string;
  @IsOptional() @IsString() @Length(0, 200) line2?: string | null;
  @IsOptional() @IsString() @Length(2, 100) city?: string;
  @IsOptional() @IsString() @Length(2, 64) state?: string;
  @IsOptional() @IsString() @Length(3, 16) postalCode?: string;
  @IsOptional() @IsString() @Length(2, 2) countryIso2?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly service: AddressesService) {}

  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const rows = await this.service.list(user.id);
    return { items: rows.map(serialize) };
  }

  @Throttle({ addresses_create: { limit: 10, ttl: 60_000 } })
  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() dto: AddressDto) {
    const row = await this.service.create(user.id, dto);
    return serialize(row);
  }

  @Throttle({ addresses_update: { limit: 20, ttl: 60_000 } })
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: PartialAddressDto,
  ) {
    const row = await this.service.update(user.id, id, dto);
    return serialize(row);
  }

  @Throttle({ addresses_default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/default')
  async setDefault(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const row = await this.service.setDefault(user.id, id);
    return serialize(row);
  }

  @Throttle({ addresses_delete: { limit: 10, ttl: 60_000 } })
  @Delete(':id')
  async destroy(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.softDelete(user.id, id);
  }
}

function serialize(row: import('@prisma/client').ShippingAddress) {
  return {
    id: row.id,
    fullName: row.fullName,
    phoneE164: row.phoneE164,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    countryIso2: row.countryIso2,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
