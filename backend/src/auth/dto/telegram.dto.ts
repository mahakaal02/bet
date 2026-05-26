import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Payload Telegram's web-auth widget (`oauth.telegram.org/auth`)
 * 302-redirects back to our callback with. The auctions Next.js
 * callback already HMAC-verifies this payload server-side, but the
 * backend re-verifies as defense in depth — both ends share the
 * `TELEGRAM_BOT_TOKEN` env so neither can be bypassed in isolation.
 *
 * Field names match Telegram's documented contract exactly
 * (https://core.telegram.org/widgets/login#receiving-authorization-data):
 *
 *   id          number  — Telegram user ID (stable per account)
 *   first_name  string  — required
 *   last_name   string? — optional
 *   username    string? — current @username (mutable)
 *   photo_url   string? — current avatar URL
 *   auth_date   number  — unix seconds when Telegram signed
 *   hash        string  — HMAC over the other fields
 *
 * `hash` is the only field that travels for verification — the
 * service module re-hashes the remaining fields and compares.
 */
export class TelegramAuthDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  @Length(1, 64)
  first_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  last_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  photo_url?: string;

  @IsNumber()
  @Min(0)
  auth_date!: number;

  @IsString()
  @Length(64, 64)
  hash!: string;
}
