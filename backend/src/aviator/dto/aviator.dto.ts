import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class PlaceAviatorBetDto {
  @IsInt()
  @Min(1)
  @Max(10_000)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1.01)
  @Max(1_000)
  autoCashoutAt?: number;
}

export class SendChatMessageDto {
  @IsString()
  @Length(1, 280)
  message!: string;
}
