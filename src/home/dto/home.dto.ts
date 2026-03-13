import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

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

export class CompleteSessionDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  duration_minutes?: number;
}
