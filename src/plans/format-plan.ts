import { ACCENT_COLORS } from '../home/session-exercise.service';
import { exerciseImageUrl } from '../common/exercise-image';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Canonical serializer for a PlanDay row → the iOS-facing JSON shape.
 * Shared between `PlansService.getActivePlan` (Plan tab source of
 * truth) and `HomeService.getDashboard` (Phase 3 — embeds plan_days
 * so the iOS AppContext can render the full week without a second
 * round-trip).
 */
export function formatPlanDay(day: any) {
  const exercises = (day.exercises_json ?? []) as any[];
  return {
    id: day.id,
    dayOfWeek: day.day_of_week,
    dayLabel: DAY_LABELS[day.day_of_week] ?? 'Day',
    dayType: day.day_type,
    status: day.status,
    sessionTitle: day.session_title,
    sessionType: day.session_type,
    muscleGroups: day.muscle_groups,
    exercises: exercises.map((e: any, i: number) => ({
      name: e.name,
      muscleGroup: e.muscle_group,
      setsDisplay: e.sets_display,
      libraryExerciseId: e.library_exercise_id ?? null,
      accentColor: ACCENT_COLORS[i % ACCENT_COLORS.length],
      suggestedWeight: e.suggested_weight ?? null,
      imageUrl: exerciseImageUrl(e.external_id),
      externalId: e.external_id ?? null,
    })),
    workoutSession: day.workout_session
      ? {
          id: day.workout_session.id,
          durationMinutes: day.workout_session.duration_minutes,
          completedAt:
            day.workout_session.completed_at?.toISOString() ?? null,
        }
      : null,
    aiNotes: day.ai_notes,
  };
}
