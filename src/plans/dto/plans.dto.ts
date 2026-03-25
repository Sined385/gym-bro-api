import { IsBoolean, IsOptional } from 'class-validator';

export class GeneratePlanDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
