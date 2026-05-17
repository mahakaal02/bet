import { IsString, Matches } from 'class-validator';

const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export class PlaceBidDto {
  @IsString()
  @Matches(AMOUNT_REGEX, { message: 'amount must be positive with up to 2 decimal places' })
  amount!: string;
}
