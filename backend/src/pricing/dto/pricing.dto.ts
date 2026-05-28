import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Body for POST /admin/pricing/sync — all optional; defaults to
 *  "publish current UTC year". */
export class RunSyncDto {
  @IsOptional()
  @IsInt()
  @Min(2024)
  @Max(2100)
  year?: number;

  /** false → generate a DRAFT for review instead of publishing. */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** Body for PATCH /admin/pricing/rows/:id — admin price override. */
export class OverridePriceDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative number with up to 2 decimals',
  })
  roundedFinalPrice!: string;
}

/** Body for PATCH /admin/pricing/ppp/:id — multiplier override. */
export class OverrideMultiplierDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'multiplier must be a non-negative number with up to 4 decimals',
  })
  multiplier!: string;
}

/** Body for upserting a coin pack's USD anchor + SKU (admin). */
export class UpsertPackPricingDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'baseUsdPrice must be a number' })
  baseUsdPrice?: string;

  @IsOptional()
  @IsString()
  @Length(2, 64)
  sku?: string;
}
