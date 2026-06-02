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

function formatSet(s: RecentLiftSet): string {
  if (s.isBodyweight) return `BW × ${s.reps}`;
  if (s.weight === null) return `— × ${s.reps}`;
  return `${s.weight}kg × ${s.reps}`;
}

/**
 * Renders the recent-lifts list as a labeled block for the system
 * prompt. Same shape as the one CoachPromptService used to embed
 * inline — moved here so the plan prompt can reuse the exact format.
 */
export function formatRecentLiftsBlock(lifts: RecentLift[]): string {
  if (lifts.length === 0) {
    return 'No recent lifts to anchor progression against.';
  }
  return `Your recent lifts (for any of these in a new workout, REUSE the exercise and supply target_sets that mirror the last ladder with the top set bumped to the "suggest" value):\n${lifts
    .map((l) => {
      const libRef = l.libraryExerciseId ? ` (lib_id: ${l.libraryExerciseId})` : '';
      const ladder = l.sets.map(formatSet).join(', ');
      const suggest = formatSet(l.suggestedTopSet);
      return `- ${l.name}${libRef} — last ${l.lastDate}: ${ladder} — suggest top set ${suggest}`;
    })
    .join('\n')}`;
}
