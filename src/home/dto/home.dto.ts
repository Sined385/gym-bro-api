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

export class ReorderExercisesDto {
  // The full list of session-exercise IDs in their new order. Position in
  // the array becomes the new step_number (1-indexed). Must include every
  // exercise currently in the session — partial lists are rejected.
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

  // Cardio logging — set when the exercise is duration-based (treadmill,
  // bike, rower). Strength sets omit both and rely on weight + reps.
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  distance_meters?: number;
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

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  distance_meters?: number;
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

  /// Apple Watch / HealthKit-derived average heart rate over the session.
  /// Optional — not every user wears a watch.
  @IsOptional()
  @IsInt()
  @IsPositive()
  avg_heart_rate?: number;

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

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  distance_meters?: number;
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

  // Optional metadata for the create-on-complete path. When iOS
  // completes a session that never had a server-side row (the new
  // "store on complete only" flow), the client sends the full
  // descriptor so the server can construct the WorkoutSession from
  // scratch and link it to the plan day.
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  ai_message?: string;

  @IsOptional()
  @IsString()
  started_at?: string;

  @IsOptional()
  @IsString()
  plan_day_id?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  avg_heart_rate?: number;

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
