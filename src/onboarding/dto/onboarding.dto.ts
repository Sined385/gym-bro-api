export interface InjuryDto {
  type: string;
  value: string;
}

export interface SaveOnboardingDto {
  primary_goals: string[];
  primary_sports: string[];
  experience_level: string;
  training_frequency: number;
  workout_duration: number;
  preferred_rest_time?: number;
  available_equipment: string;
  injuries?: InjuryDto[];
  weight_kg?: number;
  height_cm?: number;
  biological_sex?: string;
  completed_at: string;
}
