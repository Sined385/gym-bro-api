/**
 * Shared helpers for building per-set target ladders that get
 * persisted into:
 *   - session_exercise.exercise_sets (Coach create_workout_session)
 *   - plan_day.exercises_json[i].target_sets (linkSessionToToday,
 *     adaptPlanDayToActualSession, plansService.generatePlan)
 *
 * iOS reads `target_sets` off plan_day.exercises_json (via
 * formatPlanDay → `sets`) and off session_exercise rows (via
 * serializeExerciseSets in format-session). Without these helpers
 * each call site reinvents the parse / equipment-mapping logic and
 * drifts.
 */

// Library equipment values that categorically imply external load —
// is_bodyweight must be FALSE for these regardless of what an AI
// suggested. Sourced from scripts/seed-exercise-library.ts:
// EQUIPMENT_MAP plus the AI-callable tool surface area.
export const WEIGHTED_EQUIPMENT = new Set([
  'Barbell',
  'Dumbbells',
  'Machine',
  'Cable',
  'Kettlebells',
]);

// Equipment values that are inherently load-less (or use the user's
// own body / a band). is_bodyweight should be TRUE here, and the
// weight field stays empty.
export const BODYWEIGHT_EQUIPMENT = new Set(['Bodyweight', 'Bands']);

export function isWeightedEquipment(
  equipment: string | null | undefined,
): boolean {
  if (!equipment) return false;
  return WEIGHTED_EQUIPMENT.has(equipment);
}

export function isBodyweightEquipment(
  equipment: string | null | undefined,
): boolean {
  if (!equipment) return false;
  return BODYWEIGHT_EQUIPMENT.has(equipment);
}

/**
 * Pull the leading two integers from a "3 × 10" / "4 × 8" /
 * "2 × 30 sec" pattern. Falls back to (3, 10) when the string is
 * missing or unparseable so we never end up writing a zero-set
 * ladder.
 */
export function parseSetsDisplay(setsDisplay: string | null | undefined): {
  setCount: number;
  reps: number;
} {
  if (!setsDisplay) return { setCount: 3, reps: 10 };
  const match = setsDisplay.match(/(\d+)\s*[×x]\s*(\d+)/i);
  if (!match) return { setCount: 3, reps: 10 };
  const setCount = parseInt(match[1], 10);
  const reps = parseInt(match[2], 10);
  return {
    setCount: setCount > 0 ? setCount : 3,
    reps: reps > 0 ? reps : 10,
  };
}

/**
 * The canonical shape we persist in plan_day.exercises_json[i].target_sets
 * and in any other JSON column that holds per-set targets. MUST match
 * the shape `serializeExerciseSets` reads on the read path and the
 * shape iOS's `DashboardExerciseSet` decodes (post convertFromSnakeCase
 * → setNumber / weight / weightUnit / reps / isBodyweight). The earlier
 * AI-internal shape (`weight_kg`) is only valid in transient args to
 * the Coach tool call — never as persisted JSON.
 */
export interface SynthSet {
  set_number: number;
  weight: number | null;
  weight_unit: string;
  reps: number;
  is_bodyweight: boolean;
  // Cardio-only fields. Always null for strength sets; set for cardio
  // sets (treadmill, bike, rower, …). When duration_seconds is set,
  // weight/reps are expected to be null/0 — iOS renders a duration pill
  // instead of the weight × reps row.
  duration_seconds?: number | null;
  distance_meters?: number | null;
  // Target pace (km/h) for cardio — guidance the user dials into the
  // machine. Null for strength and for cardio the AI didn't pace.
  target_speed_kmh?: number | null;
}

/**
 * Cardio exercises bypass the weight × reps ladder entirely. We persist
 * a single "set" carrying the target duration (and optionally a target
 * pace) so the existing sets[] pipeline can flow strength + cardio
 * through the same shape.
 *
 * Defaults: 30 minutes when no target is supplied. The library row's
 * `category === 'cardio'` is the canonical signal — see isCardioCategory.
 */
export function synthesizeCardioTargetSets(args: {
  targetDurationMinutes?: number | null;
  targetSpeedKmh?: number | null;
}): SynthSet[] {
  const minutes =
    args.targetDurationMinutes &&
    args.targetDurationMinutes > 0 &&
    args.targetDurationMinutes < 24 * 60
      ? args.targetDurationMinutes
      : 30;
  const speed =
    args.targetSpeedKmh && args.targetSpeedKmh > 0 && args.targetSpeedKmh < 100
      ? args.targetSpeedKmh
      : null;
  return [
    {
      set_number: 1,
      weight: null,
      weight_unit: 'kg',
      reps: 0,
      is_bodyweight: false,
      duration_seconds: Math.round(minutes * 60),
      distance_meters: null,
      target_speed_kmh: speed,
    },
  ];
}

export function isCardioCategory(category: string | null | undefined): boolean {
  return typeof category === 'string' && category.toLowerCase() === 'cardio';
}

/**
 * Cardio types exposed to users. Anything else under category=cardio /
 * muscle_group="Cardio" stays hidden (rows stay in the DB so existing
 * sessions/plans keep their links but are filtered out of selection
 * surfaces — library browse, Coach, plan generation). Keep in sync with
 * ALLOWED_CARDIO in scripts/seed-exercise-library.ts.
 */
export const AVAILABLE_CARDIO_EXTERNAL_IDS = new Set<string>([
  'Bicycling_Stationary',
  'Elliptical_Trainer',
  'Jogging_Treadmill',
  'Recumbent_Bike',
  'Rope_Jumping',
  'Rowing_Stationary',
  'Running_Treadmill',
  'Stairmaster',
  'Walking_Treadmill',
]);

/**
 * True for a cardio library row that is NOT in the user-available set, so
 * it should be hidden from selection surfaces. Works off either signal
 * (`category` or `muscle_group`) so callers don't all have to select the
 * same columns.
 *
 * USER-CREATED rows are never hidden: the allowlist gates which SYSTEM
 * cardio types we ship, but a custom cardio exercise (is_system=false /
 * user_id set, external_id null) was explicitly created by its owner —
 * hiding it would make it vanish right after creation.
 */
export function isHiddenCardio(row: {
  category?: string | null;
  muscle_group?: string | null;
  external_id?: string | null;
  is_system?: boolean;
  user_id?: string | null;
}): boolean {
  if (row.is_system === false || row.user_id != null) return false;
  const isCardio =
    isCardioCategory(row.category) ||
    (row.muscle_group ?? '').toLowerCase() === 'cardio';
  return isCardio && !AVAILABLE_CARDIO_EXTERNAL_IDS.has(row.external_id ?? '');
}

/**
 * Decide whether an exercise should be treated as cardio (duration block)
 * vs strength. The library `category` is AUTHORITATIVE: a row explicitly
 * tagged a non-cardio category (e.g. plyometrics, strength) is NEVER
 * cardio, even if the AI hinted `is_cardio: true` — this stops the model
 * turning "Catch and Overhead Throw" into a fake 20-min cardio block. The
 * AI hint is honored only when the row has no explicit category to defer
 * to (null/empty — e.g. some user-created exercises).
 */
export function resolveIsCardio(
  category: string | null | undefined,
  aiIsCardio: boolean | undefined,
): boolean {
  if (isCardioCategory(category)) return true;
  const hasExplicitCategory =
    typeof category === 'string' && category.trim().length > 0;
  return aiIsCardio === true && !hasExplicitCategory;
}

/**
 * Build a flat per-set ladder for an exercise that has no recent
 * history. Reps come from sets_display; weight comes from
 * WeightSuggestionService's per-exercise estimate. is_bodyweight is
 * computed from the library's equipment field — NOT from any AI
 * flag, which we've seen incorrectly mark Dumbbell Bench Press as
 * bodyweight.
 */
export function synthesizeTargetSets(args: {
  setsDisplay: string | null | undefined;
  equipment: string | null | undefined;
  suggestedWeight: number | null | undefined;
}): SynthSet[] {
  const { setCount, reps } = parseSetsDisplay(args.setsDisplay);
  const isBW = isBodyweightEquipment(args.equipment);
  const weight =
    isBW || args.suggestedWeight === null || args.suggestedWeight === undefined
      ? null
      : args.suggestedWeight;
  return Array.from({ length: setCount }, (_, i) => ({
    set_number: i + 1,
    weight,
    weight_unit: 'kg',
    reps,
    is_bodyweight: isBW,
  }));
}
