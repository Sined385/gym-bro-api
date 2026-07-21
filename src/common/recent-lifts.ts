// Pure helpers shared by Coach single-workout creation and weekly plan
// generation. The APP owns progression for exercises with history: the
// next ladder is computed deterministically from the last recorded one
// (buildProgressedLadder / applyProgression below). The AI only supplies
// target_sets for novel exercises — or to deliberately deviate (deload,
// different scheme). Keeping the implementation as free functions avoids
// a Coach ↔ Plans module dependency.

export interface RecentLiftSet {
  weight: number | null;
  reps: number;
  isBodyweight: boolean;
}

export interface RecentLift {
  libraryExerciseId: string | null;
  // external_id is sourced from the upstream exercise DB and survives
  // re-seeds (the seed script wipes library_exercise_id on historical
  // session_exercise rows when it deletes + re-inserts the system
  // library with fresh UUIDs). external_id is the stable bridge that
  // lets us match a past session against the current library.
  externalId: string | null;
  name: string;
  muscleGroup: string;
  lastDate: string;
  sets: RecentLiftSet[];
  topSet: RecentLiftSet;
  suggestedTopSet: RecentLiftSet;
}

/**
 * The deterministic progression rule (double progression):
 *  - Bodyweight or no weight recorded → +1 rep at same load.
 *  - Weighted, reps < 12 → +1 rep at same weight (3×8 → 3×9).
 *  - Weighted, reps ≥ 12 → +2.5 kg, reps drop by 4 (min 5) —
 *    build reps up to 12, then add load and restart the climb
 *    (3×12 @ 40 → 3×8 @ 42.5).
 */
export function progressSet(set: RecentLiftSet): RecentLiftSet {
  if (set.isBodyweight || set.weight === null) {
    return { ...set, reps: set.reps + 1 };
  }
  if (set.reps >= 12) {
    return {
      ...set,
      weight: set.weight + 2.5,
      reps: Math.max(5, set.reps - 4),
    };
  }
  return { ...set, reps: set.reps + 1 };
}

/**
 * Distills the `recentSessions` payload (sessions ordered DESC by
 * completed_at) into one entry per exercise: the most recent session
 * it was performed in, the full set ladder, the heaviest set, and the
 * `progressSet` suggestion for the top working set.
 */
export function computeRecentLifts(recentSessions: any[]): RecentLift[] {
  const seen = new Map<string, RecentLift>();
  for (const session of recentSessions) {
    const dateStr = session.completed_at
      ? new Date(session.completed_at).toISOString().split('T')[0]
      : 'unknown';
    for (const ex of session.exercises ?? []) {
      const key = ex.library_exercise_id || `name:${ex.name}`;
      if (seen.has(key)) continue;
      const sets: RecentLiftSet[] = (ex.exercise_sets ?? []).map((s: any) => ({
        weight: s.weight !== null ? Number(s.weight) : null,
        reps: s.reps,
        isBodyweight: s.is_bodyweight ?? false,
      }));
      if (sets.length === 0) continue;
      const topSet = sets.reduce((best, s) => {
        const bw = best.isBodyweight ? 0 : (best.weight ?? 0);
        const sw = s.isBodyweight ? 0 : (s.weight ?? 0);
        if (sw > bw) return s;
        if (sw === bw && s.reps > best.reps) return s;
        return best;
      }, sets[0]);
      const suggestedTopSet = progressSet(topSet);
      seen.set(key, {
        libraryExerciseId: ex.library_exercise_id ?? null,
        externalId: ex.external_id ?? null,
        name: ex.name,
        muscleGroup: ex.muscle_group,
        lastDate: dateStr,
        sets,
        topSet,
        suggestedTopSet,
      });
    }
  }
  return [...seen.values()];
}

export interface TargetSetLike {
  weight_kg?: number | null;
  reps: number;
  is_bodyweight?: boolean;
}

const setLoad = (weight: number | null | undefined, bw?: boolean) =>
  bw ? 0 : (weight ?? 0);

/**
 * "N × M" pill for a per-set ladder, where M is the WORKING-set reps —
 * the reps of the heaviest set, not the max across the whole ladder.
 * Using the overall max let a 40kg×12 warm-up label a 72.5kg×8 session
 * as "4 × 12", which reads as "no progression" on the workout card.
 */
export function targetSetsDisplay(sets: TargetSetLike[]): string {
  if (sets.length === 0) return '3 × 10';
  const top = sets.reduce((best, s) => {
    const bl = setLoad(best.weight_kg, best.is_bodyweight);
    const sl = setLoad(s.weight_kg, s.is_bodyweight);
    if (sl > bl) return s;
    if (sl === bl && s.reps > best.reps) return s;
    return best;
  }, sets[0]);
  return `${sets.length} × ${top.reps}`;
}

/**
 * The app-computed next ladder for an exercise with history: last
 * session's ladder with `progressSet` applied to every WORKING set
 * (sets at the top load). Lighter sets (warm-ups) are preserved
 * verbatim so 50×10, 60×8, 80×5, 80×5 → 50×10, 60×8, 80×6, 80×6.
 */
export function buildProgressedLadder(lift: RecentLift): TargetSetLike[] {
  const topLoad = setLoad(lift.topSet.weight, lift.topSet.isBodyweight);
  return lift.sets.map((s) => {
    const isWorkingSet = setLoad(s.weight, s.isBodyweight) === topLoad;
    const target = isWorkingSet ? progressSet(s) : s;
    return {
      weight_kg: target.isBodyweight ? undefined : (target.weight ?? undefined),
      reps: target.reps,
      is_bodyweight: target.isBodyweight,
    };
  });
}

/**
 * Decide the final ladder for an exercise the user has history for.
 * The APP owns progression — whatever the AI returned is replaced by
 * the deterministic `buildProgressedLadder` EXCEPT when the AI ladder
 * is a clearly intentional deviation:
 *  - a different set count than the recorded ladder (restructure,
 *    e.g. the user asked for 5×5), or
 *  - a meaningfully lighter top load (< 95% of last session's —
 *    a deload / "give me an easy day" request).
 * Cardio duration blocks pass through untouched.
 */
export function applyProgression<T extends TargetSetLike>(
  aiTargetSets: T[] | undefined,
  lift: RecentLift,
): TargetSetLike[] {
  const supplied = Array.isArray(aiTargetSets) ? aiTargetSets : [];

  // Duration blocks (cardio) aren't a weight/rep progression.
  if (supplied.some((s: any) => s.duration_seconds != null)) {
    return supplied;
  }

  if (supplied.length > 0) {
    // Intentional restructure: different set count than history.
    if (supplied.length !== lift.sets.length) return supplied;

    // Intentional deload: meaningfully lighter top load than history.
    const liftTopLoad = setLoad(lift.topSet.weight, lift.topSet.isBodyweight);
    const aiTopLoad = supplied.reduce(
      (best, s) => Math.max(best, setLoad(s.weight_kg, s.is_bodyweight)),
      0,
    );
    if (liftTopLoad > 0 && aiTopLoad < liftTopLoad * 0.95) return supplied;
  }

  // Echo, near-echo, over-eager bump, or nothing supplied — the app's
  // deterministic progression wins.
  return buildProgressedLadder(lift);
}

function formatSet(s: RecentLiftSet): string {
  if (s.isBodyweight) return `BW × ${s.reps}`;
  if (s.weight === null) return `— × ${s.reps}`;
  return `${s.weight}kg × ${s.reps}`;
}

/**
 * Re-resolve every recent lift to the CURRENT library row, using
 * external_id as the stable bridge across re-seeds. Returns a Map keyed
 * by current `library_exercise_id` so callers can do
 * `map.get(libEx.id)` after the strict-library match without caring
 * whether the historical `library_exercise_id` was nulled.
 *
 * Also indexes by the historical libraryExerciseId when it's still
 * present (no re-seed has happened), so the lookup works in both
 * regimes.
 */
export function buildRecentLiftsLookup(
  lifts: RecentLift[],
  library: Array<{ id: string; external_id: string | null }>,
): Map<string, RecentLift> {
  const byExternalId = new Map<string, string>();
  for (const lib of library) {
    if (lib.external_id) byExternalId.set(lib.external_id, lib.id);
  }
  const lookup = new Map<string, RecentLift>();
  for (const lift of lifts) {
    if (lift.libraryExerciseId) lookup.set(lift.libraryExerciseId, lift);
    if (lift.externalId) {
      const currentId = byExternalId.get(lift.externalId);
      if (currentId) lookup.set(currentId, lift);
    }
  }
  return lookup;
}

/**
 * Renders the recent-lifts list as a labeled block for the system
 * prompt. Same shape as the one CoachPromptService used to embed
 * inline — moved here so the plan prompt can reuse the exact format.
 *
 * When `library` is provided, lifts whose historical
 * library_exercise_id was nulled by a re-seed are re-bridged via
 * external_id to the CURRENT library row's id — so the AI sees a
 * live lib_id it can pass back through the tool call, instead of
 * falling back to fuzzy name matching against a drifted catalog.
 */
export function formatRecentLiftsBlock(
  lifts: RecentLift[],
  library?: Array<{ id: string; external_id: string | null }>,
): string {
  if (lifts.length === 0) {
    return 'No recent lifts to anchor progression against.';
  }
  const byExternalId = new Map<string, string>();
  if (library) {
    for (const lib of library) {
      if (lib.external_id) byExternalId.set(lib.external_id, lib.id);
    }
  }
  return `Your recent lifts. REUSE these exercises where they fit the workout — the user wants to progress on them. Do NOT supply target_sets for them: the app computes the next progression from history automatically. Only supply target_sets for one of these when you deliberately intend a DIFFERENT scheme (the user asked for a deload / lighter day, or a different set/rep structure like 5×5):\n${lifts
    .map((l) => {
      const liveLibId =
        l.libraryExerciseId ??
        (l.externalId ? (byExternalId.get(l.externalId) ?? null) : null);
      const libRef = liveLibId ? ` (lib_id: ${liveLibId})` : '';
      const ladder = l.sets.map(formatSet).join(', ');
      const suggest = formatSet(l.suggestedTopSet);
      return `- ${l.name}${libRef} — last ${l.lastDate}: ${ladder} — suggest top set ${suggest}`;
    })
    .join('\n')}`;
}
