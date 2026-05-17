import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsappAuthController } from './auth-whatsapp.controller';
import { WhatsappAuthService } from './auth-whatsapp.service';

@Module({
  imports: [AuthModule],
  controllers: [WhatsappAuthController],
  providers: [WhatsappAuthService],
})
export class WhatsappAuthModule {}
