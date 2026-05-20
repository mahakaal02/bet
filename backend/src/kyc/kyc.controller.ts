import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsEnum } from 'class-validator';
import { memoryStorage } from 'multer';
import { DocumentKind } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';

/**
 * Authenticated KYC endpoints (Roadmap §F-USER-13).
 *
 *   GET   /me/kyc                    — current state + per-doc rows
 *   POST  /me/kyc/document           — multipart 'file' + `kind` body
 *   GET   /me/kyc/withdrawal-eligibility — used by Bet's wallet
 *
 * Multer is configured with `memoryStorage()` (not disk) because the
 * service must run the virus scanner on the plaintext bytes BEFORE
 * we persist anything. Writing to disk first creates a window where
 * infected bytes sit in `/tmp` waiting for the scanner. Memory
 * buffers go away on scanner failure.
 *
 * Size cap is enforced at three levels:
 *   1. Multer `limits.fileSize` (this file) — fast-reject.
 *   2. Body-parser default — node default is fine for our cap.
 *   3. Service-layer `MAX_DOCUMENT_BYTES` — belt for the SDK path.
 */

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

class SubmitDocumentDto {
  @IsEnum(DocumentKind)
  kind!: DocumentKind;
}

@Controller('me/kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly svc: KycService) {}

  @Get()
  async status(@CurrentUser() user: AuthedUser) {
    return this.svc.getStatus(user.id);
  }

  @Get('withdrawal-eligibility')
  async eligibility(@CurrentUser() user: AuthedUser) {
    return this.svc.withdrawalEligibility(user.id);
  }

  /**
   * One upload per minute keeps a misbehaving client from carpet-
   * bombing the scanner. Scoped to the 'default' bucket — the
   * heavy-bid throttle isn't relevant here.
   */
  @Post('document')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: KycService.MAX_DOCUMENT_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: AuthedUser,
    @Body() body: SubmitDocumentDto,
    @UploadedFile() file: MulterFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'KYC_FILE_REQUIRED' });
    }
    return this.svc.submitDocument({
      userId: user.id,
      kind: body.kind,
      mimeType: file.mimetype,
      payload: file.buffer,
    });
  }
}
