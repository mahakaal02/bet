import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DocumentKind, ReviewState } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Perm, PermsGuard } from '../admin/perms.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';

/**
 * Admin-side KYC review endpoints (PR-KYC-2).
 *
 *   GET   /admin/kyc                 — list documents pending review
 *   GET   /admin/kyc/:id/file        — stream decrypted bytes (audited)
 *   POST  /admin/kyc/:id/approve     — mark approved, bump tier
 *   POST  /admin/kyc/:id/reject      — mark rejected, with notes
 *   POST  /admin/kyc/:id/resubmit    — soft reject (request fresh doc)
 *
 * Permission gate: `kyc.view` for list + bytes, `kyc.review` for the
 * approve/reject/resubmit mutations. Both currently held by FINANCE.
 *
 * The bytes endpoint streams the **decrypted** plaintext so the
 * reviewer can see the PAN / selfie / etc. directly. Every read is
 * audited (see `KycService.readDocument`) — viewing a document is a
 * privileged action regardless of intent.
 */

class RejectDto {
  @IsString() @MinLength(4) @MaxLength(500)
  notes!: string;
}

class ApproveDto {
  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

class ListQueryDto {
  @IsOptional() @IsEnum(DocumentKind) kind?: DocumentKind;
  @IsOptional() @IsEnum(ReviewState) state?: ReviewState;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: number;
}

@UseGuards(JwtAuthGuard, PermsGuard)
@Controller('admin/kyc')
export class KycAdminController {
  constructor(private readonly svc: KycService) {}

  @Get()
  @Perm('kyc.view')
  async list(@Query() q: ListQueryDto) {
    const limit = q.limit ? Number(q.limit) : undefined;
    return this.svc.listForReview({
      kind: q.kind,
      state: q.state,
      cursor: q.cursor,
      limit,
    });
  }

  @Get(':id/file')
  @Perm('kyc.view')
  async file(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const result = await this.svc.readDocument({
      reviewer: { id: user.id, email: user.email ?? '' },
      documentId: id,
    });
    res.set('Content-Type', result.mimeType);
    // Inline so the browser tab previews jpegs / pdfs.
    res.set('Content-Disposition', `inline; filename="${id}.${extensionFor(result.mimeType)}"`);
    res.set('Cache-Control', 'no-store, private');
    res.send(result.bytes);
  }

  @Post(':id/approve')
  @Perm('kyc.review')
  async approve(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: ApproveDto,
  ) {
    return this.svc.approve({
      reviewer: { id: user.id, email: user.email ?? '' },
      documentId: id,
      notes: body.notes,
    });
  }

  @Post(':id/reject')
  @Perm('kyc.review')
  async reject(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: RejectDto,
  ) {
    return this.svc.reject({
      reviewer: { id: user.id, email: user.email ?? '' },
      documentId: id,
      notes: body.notes,
    });
  }

  @Post(':id/resubmit')
  @Perm('kyc.review')
  async resubmit(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: RejectDto,
  ) {
    return this.svc.requestResubmit({
      reviewer: { id: user.id, email: user.email ?? '' },
      documentId: id,
      notes: body.notes,
    });
  }
}

function extensionFor(mime: string): string {
  if (mime.startsWith('image/jpeg')) return 'jpg';
  if (mime.startsWith('image/png')) return 'png';
  if (mime.startsWith('application/pdf')) return 'pdf';
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('video/webm')) return 'webm';
  return 'bin';
}
