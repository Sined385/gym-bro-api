export interface InjuryDto {
  type: string;
  value: string;
}

export interface SaveOnboardingDto {
  // Accept both singular (prod mobile) and plural (new clients) formats
  primary_goal?: string;
  primary_goals?: string[];
  primary_sport?: string;
  primary_sports?: string[];
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
