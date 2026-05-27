import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class VerifyPaymentDto {
  @IsString()
  @Length(10, 64)
  orderId!: string;

  @IsString()
  @Length(10, 64)
  paymentId!: string;

  @IsString()
  @Length(16, 256)
  signature!: string;
}

/**
 * Arbitrary-rupee top-up to the unified wallet. The lower bound mirrors
 * `MIN_TOPUP_COINS` on Bet (₹100); the upper bound is a sanity cap so a
 * single Razorpay order can't accidentally request lakhs of rupees.
 */
export class CreateWalletTopupOrderDto {
  @IsInt()
  @Min(100)
  @Max(100_000)
  amount!: number;
}

/**
 * Body for POST /wallet/order — one of `coinPackId` or `amount`.
 * Bounds match `CreateWalletTopupOrderDto.amount` (100–100k).
 *
 * Lives here (next to its siblings) rather than inline in
 * wallet.controller.ts because referencing a class as a `@Body()`
 * decorator type before its declaration trips the temporal dead zone
 * under `nest start --watch` (the controller class is decorated at
 * module-load time, before the lower class declaration is reached).
 */
export class CreateWalletOrderDto {
  @IsOptional()
  @IsString()
  @Length(8, 64)
  coinPackId?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100_000)
  amount?: number;
}
