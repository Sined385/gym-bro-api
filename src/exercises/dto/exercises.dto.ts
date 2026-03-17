import { IsIn, IsString, MinLength } from 'class-validator';

const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Legs',
  'Shoulders',
  'Arms',
  'Core',
  'Other',
];

const EQUIPMENT = [
  'Barbell',
  'Dumbbells',
  'Cable',
  'Machine',
  'Bodyweight',
  'Other',
];

export class CreateExerciseDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsIn(MUSCLE_GROUPS)
  muscle_group!: string;

  @IsString()
  @IsIn(EQUIPMENT)
  equipment!: string;
}
