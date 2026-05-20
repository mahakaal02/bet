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
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketCategory, TicketCloseReason, TicketStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { TicketsService } from './tickets.service';

class AdminReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;
  @IsOptional() @IsBoolean()
  isInternal?: boolean;
}

class AssignDto {
  @IsOptional() @IsString() @MaxLength(64)
  assigneeId?: string | null;
}

class EscalateDto {
  @IsString() @MinLength(4) @MaxLength(500)
  reason!: string;
}

class CloseDto {
  @IsEnum(TicketCloseReason)
  reason!: TicketCloseReason;
}

class QueueDto {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/tickets')
export class TicketsAdminController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  @Perm('ticket.view')
  list(@Query() q: QueueDto) {
    return this.svc.listForAdmin({
      status: q.status,
      category: q.category,
      assignedToId: q.assignedToId,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get(':id')
  @Perm('ticket.view')
  detail(@Param('id') id: string) {
    return this.svc.getForAdmin(id);
  }

  @HttpCode(200)
  @Post(':id/reply')
  @Perm('ticket.reply')
  reply(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: AdminReplyDto,
  ) {
    return this.svc.adminReply({
      adminId: user.id,
      adminEmail: user.email ?? '',
      ticketId: id,
      body: dto.body,
      isInternal: dto.isInternal,
    });
  }

  @HttpCode(200)
  @Post(':id/assign')
  @Perm('ticket.reply')
  assign(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: AssignDto,
  ) {
    return this.svc.assign({
      adminId: user.id,
      adminEmail: user.email ?? '',
      ticketId: id,
      assigneeId: dto.assigneeId ?? null,
    });
  }

  @HttpCode(200)
  @Post(':id/escalate')
  @Perm('ticket.reply')
  escalate(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: EscalateDto,
  ) {
    return this.svc.escalate({
      adminId: user.id,
      adminEmail: user.email ?? '',
      ticketId: id,
      reason: dto.reason,
    });
  }

  @HttpCode(200)
  @Post(':id/close')
  @Perm('ticket.reply')
  close(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CloseDto,
  ) {
    return this.svc.close({
      adminId: user.id,
      adminEmail: user.email ?? '',
      ticketId: id,
      reason: dto.reason,
    });
  }
}
