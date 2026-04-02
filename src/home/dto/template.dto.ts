import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  session_id!: string;
}

export class UpdateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
