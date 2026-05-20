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
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { FraudSeverity, FraudSignalKind } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { FraudService } from './fraud.service';

class ListDto {
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === 'true' || value === true)
  reviewed?: boolean;
  @IsOptional() @IsEnum(FraudSeverity) severity?: FraudSeverity;
  @IsOptional() @IsEnum(FraudSignalKind) kind?: FraudSignalKind;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

class ReviewDto {
  @IsOptional() @IsString() @MinLength(4) @MaxLength(500) notes?: string;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/fraud')
export class FraudController {
  constructor(private readonly svc: FraudService) {}

  @Get('signals')
  @Perm('audit.view')   // moderators + auditors can see the queue
  list(@Query() q: ListDto) {
    return this.svc.listSignals({
      reviewed: q.reviewed,
      severity: q.severity,
      kind: q.kind,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @HttpCode(200)
  @Post('signals/:id/review')
  @Perm('user.ban')   // reviewer is acting on the result — moderator privilege
  review(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: ReviewDto) {
    return this.svc.reviewSignal({
      adminId: user.id,
      adminEmail: user.email ?? '',
      signalId: id,
      notes: body.notes,
    });
  }

  /**
   * Manual cluster sweep — also runs via cron, but available
   * here so the security team can re-evaluate after a config tweak.
   */
  @HttpCode(200)
  @Post('sweep')
  @Perm('user.ban')
  sweep() {
    return this.svc.runClusterSweep();
  }
}
