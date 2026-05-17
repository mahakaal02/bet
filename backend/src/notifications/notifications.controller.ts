import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { AuthedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class RegisterDeviceDto {
  @IsString() token!: string;
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
}

@UseGuards(JwtAuthGuard)
@Controller('devices')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  register(@Body() dto: RegisterDeviceDto, @CurrentUser() user: AuthedUser) {
    return this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  @Delete(':token')
  async unregister(@Param('token') token: string) {
    await this.notifications.unregisterDevice(token);
    return { ok: true };
  }
}
