import { exerciseImageUrl } from './exercise-image';

export interface FormattableSession {
  id: string;
  user_id: string;
  title: string;
  type: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  duration_minutes: number | null;
  ai_generated: boolean;
  ai_message: string | null;
  created_at: Date;
  updated_at: Date;
  exercises: {
    id: string;
    name: string;
    step_number: number;
    sets_display: string;
    accent_color: string;
    library_exercise_id: string | null;
    external_id: string | null;
    muscle_group: string | null;
    equipment: string | null;
    suggested_weight: number | null;
  }[];
}

export function formatSessionResponse(session: FormattableSession) {
  return {
    id: session.id,
    user_id: session.user_id,
    title: session.title,
    type: session.type,
    status: session.status,
    started_at: session.started_at?.toISOString() ?? null,
    completed_at: session.completed_at?.toISOString() ?? null,
    duration_minutes: session.duration_minutes,
    ai_generated: session.ai_generated,
    ai_message: session.ai_message,
    created_at: session.created_at.toISOString(),
    updated_at: session.updated_at.toISOString(),
    exercises: session.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      step_number: e.step_number,
      sets_display: e.sets_display,
      accent_color: e.accent_color,
      library_exercise_id: e.library_exercise_id ?? null,
      muscle_group: e.muscle_group ?? null,
      equipment: e.equipment ?? null,
      suggested_weight: e.suggested_weight ?? null,
      image_url: exerciseImageUrl(e.external_id),
      external_id: e.external_id ?? null,
    })),
  };
}
