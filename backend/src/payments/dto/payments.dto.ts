import { IsInt, IsString, Length, Max, Min } from 'class-validator';

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
