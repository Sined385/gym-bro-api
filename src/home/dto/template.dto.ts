import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  session_ids?: string[];
}

export class UpdateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
