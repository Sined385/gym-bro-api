// Pure helpers shared by Coach single-workout creation and weekly plan
// generation. Both flows need to: (1) tell the AI what the user's
// current "top set" is for each exercise they've recently performed
// and (2) instruct the AI to ship per-set targets (target_sets)
// mirroring last session's ladder with a small load bump on the top
// working set. Keeping the implementation as a free function avoids a
// Coach ↔ Plans module dependency.

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
 * Distills the `recentSessions` payload (sessions ordered DESC by
 * completed_at) into one entry per exercise: the most recent session
 * it was performed in, the full set ladder, the heaviest set, and a
 * server-computed "suggest" load for the top working set.
 *
 * Progression rules:
 *  - Bodyweight or no weight recorded → +1 rep at same load.
 *  - Weighted, reps ≥ 5 → +2.5 kg same reps.
 *  - Weighted, reps < 5 (heavy attempt) → +1 rep at same weight.
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
      let suggestedTopSet: RecentLiftSet;
      if (topSet.isBodyweight || topSet.weight === null) {
        suggestedTopSet = { ...topSet, reps: topSet.reps + 1 };
      } else if (topSet.reps >= 5) {
        suggestedTopSet = { ...topSet, weight: (topSet.weight ?? 0) + 2.5 };
      } else {
        suggestedTopSet = { ...topSet, reps: topSet.reps + 1 };
      }
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

/**
 * Server-side progressive-overload enforcement. The prompts ask the AI
 * to bump the top working set over last session, but models routinely
 * echo the recorded ladder back verbatim. When the supplied ladder's
 * best set is exactly last session's top set — no progression, but
 * also no intentional deload — bump every set matching that top to
 * the pre-computed `suggestedTopSet`. Ladders that already progress
 * past the last top set, or that back off below it (deload), pass
 * through untouched: the AI made a call, respect it.
 */
export function enforceProgression<T extends TargetSetLike>(
  targetSets: T[],
  lift: RecentLift,
): T[] {
  if (targetSets.length === 0) return targetSets;
  // Duration blocks (cardio) aren't a weight/rep progression.
  if (targetSets.some((s: any) => s.duration_seconds != null)) {
    return targetSets;
  }

  const load = (weight: number | null | undefined, bw?: boolean) =>
    bw ? 0 : (weight ?? 0);
  const liftTopLoad = load(lift.topSet.weight, lift.topSet.isBodyweight);

  const aiTop = targetSets.reduce((best, s) => {
    if (load(s.weight_kg, s.is_bodyweight) > load(best.weight_kg, best.is_bodyweight)) return s;
    if (load(s.weight_kg, s.is_bodyweight) === load(best.weight_kg, best.is_bodyweight) && s.reps > best.reps) return s;
    return best;
  }, targetSets[0]);
  const aiTopLoad = load(aiTop.weight_kg, aiTop.is_bodyweight);

  const identicalTop =
    aiTopLoad === liftTopLoad && aiTop.reps === lift.topSet.reps;
  if (!identicalTop) return targetSets;

  const suggested = lift.suggestedTopSet;
  return targetSets.map((s) => {
    const isTop =
      load(s.weight_kg, s.is_bodyweight) === aiTopLoad && s.reps === aiTop.reps;
    if (!isTop) return s;
    return {
      ...s,
      weight_kg: suggested.isBodyweight
        ? undefined
        : (suggested.weight ?? s.weight_kg),
      reps: suggested.reps,
      is_bodyweight: suggested.isBodyweight,
    };
  });
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
  return `Your recent lifts (for any of these in a new workout, REUSE the exercise and supply target_sets that mirror the last ladder with the top set bumped to the "suggest" value):\n${lifts
    .map((l) => {
      const liveLibId =
        l.libraryExerciseId ??
        (l.externalId ? byExternalId.get(l.externalId) ?? null : null);
      const libRef = liveLibId ? ` (lib_id: ${liveLibId})` : '';
      const ladder = l.sets.map(formatSet).join(', ');
      const suggest = formatSet(l.suggestedTopSet);
      return `- ${l.name}${libRef} — last ${l.lastDate}: ${ladder} — suggest top set ${suggest}`;
    })
    .join('\n')}`;
}
