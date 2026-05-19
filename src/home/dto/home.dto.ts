import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;
}

export class AddExerciseItemDto {
  @IsOptional()
  @IsString()
  library_exercise_id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  muscle_group!: string;

  @IsOptional()
  @IsString()
  equipment?: string;
}

export class AddExercisesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddExerciseItemDto)
  exercises!: AddExerciseItemDto[];
}

export class CreateSupersetDto {
  @IsArray()
  @IsString({ each: true })
  exercise_ids!: string[];
}

export class LogSetDto {
  @IsInt()
  @Min(1)
  set_number!: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  weight_unit?: string;

  @IsInt()
  @Min(0)
  reps!: number;

  @IsOptional()
  @IsBoolean()
  is_bodyweight?: boolean;
}

export class UpdateSetDto {
  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  weight_unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reps?: number;

  @IsOptional()
  @IsBoolean()
  is_completed?: boolean;

  @IsOptional()
  @IsBoolean()
  is_bodyweight?: boolean;
}

export class FeedbackDto {
  @IsInt()
  @Min(1)
  @Max(10)
  effort_level!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  energy_level!: number;

  @IsOptional()
  @IsString()
  @IsIn(['None', 'Joint Pain', 'Muscle Tweak', 'Extreme Fatigue'])
  pain_discomfort?: string;
}

export class CompleteSessionDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeedbackDto)
  feedback?: FeedbackDto;
}

class CompleteSetItemDto {
  @IsInt()
  @Min(1)
  set_number!: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  weight_unit?: string;

  @IsInt()
  @Min(0)
  reps!: number;

  @IsOptional()
  @IsBoolean()
  is_completed?: boolean;

  @IsOptional()
  @IsBoolean()
  is_bodyweight?: boolean;
}

class CompleteExerciseItemDto {
  @IsOptional()
  @IsString()
  library_exercise_id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  muscle_group!: string;

  @IsOptional()
  @IsString()
  equipment?: string;

  @IsInt()
  @Min(1)
  step_number!: number;

  @IsOptional()
  @IsString()
  accent_color?: string;

  @IsOptional()
  @IsString()
  superset_group_id?: string;

  @IsOptional()
  @IsString()
  superset_order?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteSetItemDto)
  sets!: CompleteSetItemDto[];
}

export class CompleteSessionFullDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeedbackDto)
  feedback?: FeedbackDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteExerciseItemDto)
  exercises!: CompleteExerciseItemDto[];
}

export class GetSessionHistoryDto {
  @IsString()
  date!: string; // YYYY-MM-DD
}

export class GetCompletedDaysDto {
  @IsString()
  month!: string; // YYYY-MM
}
