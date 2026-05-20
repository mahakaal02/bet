import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthedUser, CurrentUser } from './current-user.decorator';
import { TrustedDeviceService } from './trusted-device.service';

/**
 * Trusted-device management endpoints. All under `/me/2fa/trusted-devices`
 * so they sit naturally next to the existing /me/2fa/* surface.
 *
 *   GET     /me/2fa/trusted-devices            — list active devices
 *   DELETE  /me/2fa/trusted-devices/:id        — revoke one
 *   POST    /me/2fa/trusted-devices/revoke-all — revoke every device
 *                                                 (logs the current
 *                                                 browser out of trust
 *                                                 too — they'll get a
 *                                                 2FA prompt next login)
 */
@UseGuards(JwtAuthGuard)
@Controller('me/2fa/trusted-devices')
export class TrustedDeviceController {
  constructor(private readonly service: TrustedDeviceService) {}

  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const rows = await this.service.list(user.id);
    return {
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        lastSeenAt: r.lastSeenAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revoke(user.id, id);
  }

  @HttpCode(200)
  @Post('revoke-all')
  async revokeAll(@CurrentUser() user: AuthedUser) {
    return this.service.revokeAll(user.id);
  }
}
