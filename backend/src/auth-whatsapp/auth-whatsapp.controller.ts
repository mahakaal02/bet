import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WhatsappAuthService } from './auth-whatsapp.service';
import {
  LoginDto,
  ResendOtpDto,
  StartSignupDto,
  VerifyOtpDto,
} from './dto/auth-whatsapp.dto';

@Controller('auth/whatsapp')
export class WhatsappAuthController {
  constructor(private readonly auth: WhatsappAuthService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('start')
  start(@Body() dto: StartSignupDto) {
    return this.auth.startSignup(dto.phone, dto.username, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.password);
  }

  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('resend')
  resend(@Body() dto: ResendOtpDto) {
    return this.auth.resend(dto.phone);
  }
}
