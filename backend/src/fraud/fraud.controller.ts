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
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

class BulkReviewDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsString({ each: true })
  signalIds!: string[];

  @IsOptional() @IsString() @MinLength(4) @MaxLength(500)
  batchNote?: string;
}

class BanDto {
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class UnbanDto {
  @IsString() @MinLength(4) @MaxLength(500)
  reason!: string;
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
   * Bulk review — end-of-day triage path. Per-row audit row written
   * even though the action came from one batch call.
   */
  @HttpCode(200)
  @Post('signals/bulk-review')
  @Perm('user.ban')
  bulkReview(@CurrentUser() user: AuthedUser, @Body() body: BulkReviewDto) {
    return this.svc.bulkReview({
      adminId: user.id,
      adminEmail: user.email ?? '',
      signalIds: body.signalIds,
      batchNote: body.batchNote,
    });
  }

  /**
   * Ban every user affected by a CLUSTER signal. Per-user audit
   * row + the signal is auto-flipped to reviewed.
   */
  @HttpCode(200)
  @Post('signals/:id/ban-cluster')
  @Perm('user.ban')
  banCluster(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: BanDto,
  ) {
    return this.svc.banAffectedUsers({
      adminId: user.id,
      adminEmail: user.email ?? '',
      signalId: id,
      reason: body.reason,
    });
  }

  /**
   * Reverse a fraud-ban. Used on false positives (office Wi-Fi
   * cluster, etc).
   */
  @HttpCode(200)
  @Post('users/:userId/unban')
  @Perm('user.unban')
  unbanUser(
    @CurrentUser() user: AuthedUser,
    @Param('userId') userId: string,
    @Body() body: UnbanDto,
  ) {
    return this.svc.unbanUser({
      adminId: user.id,
      adminEmail: user.email ?? '',
      userId,
      reason: body.reason,
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
