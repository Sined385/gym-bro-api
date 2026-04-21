import { IsString } from 'class-validator';

export class VerifySubscriptionDto {
  @IsString()
  transaction_id: string;

  @IsString()
  product_id: string;
}
