import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

const DECIMAL_REGEX = /^\d+(\.\d{1,2})?$/;

/** Mirrors Prisma's `AuctionManipulationMode` enum. Kept in sync by hand
 *  since class-validator's `IsEnum` needs a TS-side enum value. */
export enum AuctionManipulationModeDto {
  NORMAL = 'NORMAL',
  NO_WINNER = 'NO_WINNER',
  FIXED_WINNER = 'FIXED_WINNER',
}

export class UpsertCoinPackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  coins?: number;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_REGEX)
  priceInr?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateCoinPackDto {
  @IsInt()
  @Min(1)
  coins!: number;

  @IsString()
  @Matches(DECIMAL_REGEX)
  priceInr!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCoinSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_REGEX)
  inrPerCoin?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultCoinsPerBid?: number;
}

export class CreateAuctionDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsString()
  @Matches(DECIMAL_REGEX)
  retailPrice!: string;

  @IsInt()
  @Min(1)
  coinsPerBid!: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;
}

export class UpdateAuctionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_REGEX)
  retailPrice?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  coinsPerBid?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  /** Admin manipulation mode. NORMAL is the default; the other two values
   *  rig the outcome — see `bidding-engine.ts` for semantics. */
  @IsOptional()
  @IsEnum(AuctionManipulationModeDto)
  manipulationMode?: AuctionManipulationModeDto;

  /** Required when `manipulationMode === FIXED_WINNER`. Accept `null` to
   *  clear (when an admin flips back to NORMAL). The class-validator
   *  conditional kicks the field only when the value is provided AND
   *  not explicitly null. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @Matches(DECIMAL_REGEX)
  fixedWinningAmount?: string | null;
}
