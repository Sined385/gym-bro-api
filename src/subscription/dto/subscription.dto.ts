import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RedeemPromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;
}

export class VerifySubscriptionDto {
  @IsString()
  transaction_id: string;

  @IsString()
  product_id: string;
}

export class SyncSubscriptionDto {
  @IsBoolean()
  has_active_entitlement: boolean;

  @IsOptional()
  @IsString()
  transaction_id?: string;

  @IsOptional()
  @IsString()
  product_id?: string;
}
