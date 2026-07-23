import { IsIn, IsString, MinLength } from 'class-validator';

// Mirrors the iOS MuscleGroup filter enum — custom exercises must land
// in a bucket the library filter can actually show.
const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Legs',
  'Shoulders',
  'Arms',
  'Core',
  'Cardio',
  'Other',
];

const EQUIPMENT = [
  'Barbell',
  'Dumbbells',
  'Cable',
  'Machine',
  'Bodyweight',
  'Bands',
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
