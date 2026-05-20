import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketCategory, TicketPriority } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { TicketsService } from './tickets.service';

class SubmitDto {
  @IsString() @MinLength(4) @MaxLength(200)
  subject!: string;
  @IsString() @MinLength(10) @MaxLength(5000)
  body!: string;
  @IsEnum(TicketCategory)
  category!: TicketCategory;
  @IsOptional() @IsEnum(TicketPriority)
  priority?: TicketPriority;
  @IsOptional() @IsString() @MaxLength(64)
  linkedEntityType?: string;
  @IsOptional() @IsString() @MaxLength(64)
  linkedEntityId?: string;
}

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('me/support')
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    return this.svc.listMine({
      userId: user.id,
      cursor,
      limit: limitRaw ? Number(limitRaw) : undefined,
    });
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.svc.getMine(user.id, id);
  }

  /**
   * One submit per minute keeps a misbehaving client from carpet-
   * bombing the inbox. Anti-duplicate already prevents same-category
   * spam; this is a belt-and-braces measure.
   */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post()
  submit(@CurrentUser() user: AuthedUser, @Body() dto: SubmitDto) {
    return this.svc.submit({ userId: user.id, ...dto });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/reply')
  reply(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.svc.userReply({ userId: user.id, ticketId: id, body: dto.body });
  }
}
