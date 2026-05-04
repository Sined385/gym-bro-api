import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
