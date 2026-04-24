import {
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateExerciseDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  muscle_group!: string;

  @IsString()
  equipment!: string;

  @IsOptional()
  @IsString()
  sets_display?: string;

  @IsOptional()
  @IsString()
  library_exercise_id?: string;

  @IsOptional()
  @IsString()
  external_id?: string;
}

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateExerciseDto)
  exercises?: TemplateExerciseDto[];
}

export class UpdateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
