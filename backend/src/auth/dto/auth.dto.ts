import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  /**
   * Username is OPTIONAL. The auctions hub's signup form (and the
   * planned phone-OTP flow) collects only `email + password` — we
   * pick a username server-side by sanitising the email's local
   * part and falling back to `usr_<random>` on conflict (see
   * `AuthService.register::allocateUsername`). This mirrors the
   * Telegram OAuth path's `tg_<id>` fallback for the same reason:
   * users shouldn't have to invent an extra identifier at signup
   * time when one can be derived deterministically.
   *
   * If the caller DOES pass a username (e.g. legacy clients, admin
   * scripts), we validate it against the historical contract and
   * use it verbatim.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,20}$/, {
    message: 'username must be 3–20 chars: letters, digits, underscore',
  })
  username?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
