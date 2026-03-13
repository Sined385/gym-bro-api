export interface InjuryDto {
  type: string;
  value: string;
}

export interface SaveOnboardingDto {
  primary_goal: string;
  primary_sport: string;
  experience_level: string;
  training_frequency: number;
  workout_duration: number;
  available_equipment: string;
  injuries?: InjuryDto[];
  completed_at: string;
}
