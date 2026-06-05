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
export function parseSetsDisplay(
  setsDisplay: string | null | undefined,
): { setCount: number; reps: number } {
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
