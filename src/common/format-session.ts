import { exerciseImageUrl } from './exercise-image';

export interface FormattableExerciseSet {
  set_number: number;
  weight: number | string | null; // Decimal serializes as string from Prisma
  weight_unit?: string | null;
  reps: number;
  is_bodyweight?: boolean | null;
}

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
    // Per-set targets (Coach injection, plan day pre-fill, or AI's
    // explicit target_sets). Either source: live `exercise_sets`
    // children when the row exists in DB, or `target_sets` baked into
    // a plain object when projecting from a freshly-built session
    // (e.g. startPlanSession's read-only response). Optional so
    // legacy callers that don't carry per-set data still type-check.
    exercise_sets?: FormattableExerciseSet[];
    target_sets?: FormattableExerciseSet[];
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
      sets: serializeExerciseSets(e.exercise_sets ?? e.target_sets),
    })),
  };
}

/**
 * Normalise per-set targets into the JSON shape iOS expects across
 * dashboard / plan / coach surfaces. Centralised so every endpoint
 * emits the same field names (set_number / weight / weight_unit /
 * reps / is_bodyweight) regardless of whether the source is a live
 * `exercise_sets` row, a plain JSON `target_sets` blob, or a SSE
 * payload's `sets`.
 *
 * Defensive about legacy / drifted shapes:
 *   - `set_number` falls back to array index + 1 when missing. The
 *     previous (broken) version of synthesizeTargetSets persisted
 *     entries without set_number, and iOS's `setNumber: Int` is
 *     non-optional — a missing field crashes the WHOLE response
 *     decode and the iOS Home tab falls back to its mock data.
 *   - `weight` accepts the legacy `weight_kg` field too (AI's
 *     tool-call shape — should never reach JSON, but historical
 *     plan_day.exercises_json rows have it).
 *   - Decimal columns from Prisma serialize as strings; coerce.
 *
 * Returns an empty array when nothing's set so iOS can rely on
 * `sets.isEmpty` rather than null-checking.
 */
export function serializeExerciseSets(
  sets: FormattableExerciseSet[] | null | undefined,
): Array<{
  set_number: number;
  weight: number | null;
  weight_unit: string;
  reps: number;
  is_bodyweight: boolean;
}> {
  if (!sets || sets.length === 0) return [];
  return sets.map((s, i) => {
    const raw = s as any;
    // weight may live under `weight` (canonical) or `weight_kg`
    // (legacy AI-internal shape that leaked into some JSON rows).
    // ANY non-number gets coerced via Number(): Prisma's Decimal
    // column comes back as a Decimal object (typeof 'object'); a
    // string check alone misses it and JSON.stringify silently
    // serializes the Decimal as a string at response time, which
    // breaks iOS Codable (it expects Double).
    const weightCandidate = raw.weight ?? raw.weight_kg;
    let weight: number | null = null;
    if (weightCandidate !== null && weightCandidate !== undefined) {
      const n =
        typeof weightCandidate === 'number'
          ? weightCandidate
          : Number(weightCandidate);
      weight = Number.isFinite(n) ? n : null;
    }
    return {
      set_number:
        typeof raw.set_number === 'number' && raw.set_number > 0
          ? raw.set_number
          : i + 1,
      weight,
      weight_unit:
        typeof raw.weight_unit === 'string' && raw.weight_unit.length > 0
          ? raw.weight_unit
          : 'kg',
      reps: typeof raw.reps === 'number' ? raw.reps : 0,
      is_bodyweight: raw.is_bodyweight === true,
    };
  });
}
