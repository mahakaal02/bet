import { IsString, Length, Matches, MinLength } from 'class-validator';

// Permissive E.164: optional +, then 8–15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class StartSignupDto {
  @IsString() @Matches(PHONE_REGEX, { message: 'invalid phone format' })
  phone!: string;

  @IsString() @Matches(/^[a-zA-Z0-9_]{3,20}$/, { message: 'username must be 3–20 chars (letters, digits, underscore)' })
  username!: string;

  @IsString() @MinLength(8)
  password!: string;
}

export class VerifyOtpDto {
  @IsString() @Matches(PHONE_REGEX) phone!: string;
  @IsString() @Length(6, 6) code!: string;
}

export class LoginDto {
  @IsString() @Matches(PHONE_REGEX) phone!: string;
  @IsString() @MinLength(8) password!: string;
}

export class ResendOtpDto {
  @IsString() @Matches(PHONE_REGEX) phone!: string;
}
