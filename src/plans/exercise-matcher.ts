// Pure functions — no DI, importable by PlansService and CoachService.

export interface CandidatePool {
  muscle_group: string;
  exercises: LibraryExercise[];
}

export interface AiExerciseSelection {
  days: {
    day_of_week: number;
    exercises: { library_exercise_id: string; name: string }[];
  }[];
}

export interface ExerciseSlot {
  muscle_group: string; // Chest|Back|Legs|Shoulders|Arms|Core|Other
  rep_scheme: string; // "3 × 10"
  focus: 'compound' | 'isolation' | null;
}

export interface SkeletonDay {
  day_of_week: number;
  day_type: 'training' | 'rest';
  session_title?: string;
  session_type?: string;
  exercise_slots: ExerciseSlot[];
}

export interface PlanDayGenerated {
  day_of_week: number;
  day_type: 'training' | 'rest';
  session_title?: string;
  session_type?: string;
  muscle_groups: string[];
  exercises: {
    library_exercise_id: string;
    external_id: string | null;
    name: string;
    muscle_group: string;
    equipment: string;
    sets_display: string;
  }[];
}

export interface LibraryExercise {
  id: string;
  name: string;
  muscle_group: string;
  equipment: string;
  external_id: string | null;
  level: string | null;
  mechanic: string | null;
}

const MUSCLE_GROUP_ALIASES: Record<string, string> = {
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  glutes: 'Legs',
  hamstrings: 'Legs',
  quadriceps: 'Legs',
  calves: 'Legs',
  abs: 'Core',
  abdominals: 'Core',
  lats: 'Back',
  traps: 'Back',
  'lower back': 'Back',
  'middle back': 'Back',
};

const VALID_GROUPS = new Set([
  'Chest',
  'Back',
  'Legs',
  'Shoulders',
  'Arms',
  'Core',
  'Other',
]);

export function normalizeMuscleGroup(group: string): string {
  if (VALID_GROUPS.has(group)) return group;
  const lower = group.toLowerCase();
  return MUSCLE_GROUP_ALIASES[lower] ?? 'Other';
}

function scoreExercise(
  exercise: LibraryExercise,
  slot: ExerciseSlot,
  usedIds: Set<string>,
  recentIds: Set<string>,
  userLevel: string | null,
): number {
  let score = 0;

  // +3 mechanic match
  if (slot.focus && exercise.mechanic === slot.focus) score += 3;

  // +2 variety — not recently used
  if (!recentIds.has(exercise.id)) score += 2;

  // +2 not yet used in this plan
  if (!usedIds.has(exercise.id)) score += 2;

  // +1 level match
  if (userLevel && exercise.level === userLevel) score += 1;

  // random tiebreak 0–0.99
  score += Math.random();

  return score;
}

export function matchExercisesToSlots(
  slots: ExerciseSlot[],
  exerciseLibrary: LibraryExercise[],
  recentExerciseIds: Set<string>,
  userLevel: string | null,
): LibraryExercise[] {
  const usedIds = new Set<string>();
  const matched: LibraryExercise[] = [];

  for (const slot of slots) {
    const group = normalizeMuscleGroup(slot.muscle_group);

    // Filter by muscle group
    let candidates = exerciseLibrary.filter((e) => e.muscle_group === group);

    if (candidates.length === 0) continue;

    // Prefer unused exercises, but allow repeats if all are used
    const unused = candidates.filter((e) => !usedIds.has(e.id));
    if (unused.length > 0) candidates = unused;

    // Score and pick the best
    const scored = candidates.map((e) => ({
      exercise: e,
      score: scoreExercise(e, slot, usedIds, recentExerciseIds, userLevel),
    }));
    scored.sort((a, b) => b.score - a.score);

    const pick = scored[0].exercise;
    usedIds.add(pick.id);
    matched.push(pick);
  }

  return matched;
}

/**
 * Stage 2: Build a filtered candidate pool per muscle group for AI selection.
 * Deterministic scoring — no randomness.
 */
export function filterCandidates(
  skeleton: SkeletonDay[],
  exerciseLibrary: LibraryExercise[],
  recentExerciseIds: Set<string>,
): Map<string, LibraryExercise[]> {
  // Collect all unique muscle groups needed by the skeleton
  const neededGroups = new Set<string>();
  for (const day of skeleton) {
    for (const slot of day.exercise_slots) {
      neededGroups.add(normalizeMuscleGroup(slot.muscle_group));
    }
  }

  const pools = new Map<string, LibraryExercise[]>();

  for (const group of neededGroups) {
    const candidates = exerciseLibrary.filter((e) => e.muscle_group === group);

    // Thin pool rule: if < 8 exercises, return all
    if (candidates.length < 8) {
      pools.set(group, candidates);
      continue;
    }

    // Score deterministically
    const scored = candidates.map((e) => {
      let score = 0;
      if (e.external_id) score += 4; // has image
      if (e.mechanic === 'compound') score += 3;
      if (!recentExerciseIds.has(e.id)) score += 2; // not recently used
      if (e.level === 'beginner' || e.level === 'intermediate') score += 2;
      if (e.equipment === 'Other') score -= 2;
      return { exercise: e, score };
    });

    // Sort by score desc, then alphabetical by name for stable tiebreak
    scored.sort(
      (a, b) =>
        b.score - a.score || a.exercise.name.localeCompare(b.exercise.name),
    );

    // Select mixed pool: ~60% compound, ~30% isolation, ~10% other, capped at 15
    const compound = scored.filter((s) => s.exercise.mechanic === 'compound');
    const isolation = scored.filter((s) => s.exercise.mechanic === 'isolation');
    const other = scored.filter(
      (s) =>
        s.exercise.mechanic !== 'compound' &&
        s.exercise.mechanic !== 'isolation',
    );

    const maxPool = 15;
    const compoundCount = Math.min(compound.length, Math.round(maxPool * 0.6));
    const isolationCount = Math.min(
      isolation.length,
      Math.round(maxPool * 0.3),
    );
    const otherCount = Math.min(
      other.length,
      maxPool - compoundCount - isolationCount,
    );

    const pool = [
      ...compound.slice(0, compoundCount),
      ...isolation.slice(0, isolationCount),
      ...other.slice(0, otherCount),
    ].map((s) => s.exercise);

    pools.set(group, pool);
  }

  return pools;
}

/**
 * Stage 3 output: Convert AI-picked exercise IDs back to full PlanDayGenerated[]
 * by looking up exercises in the candidate pools. Uses sets_display from skeleton slots.
 */
export function assembleFromAiSelection(
  skeleton: SkeletonDay[],
  aiSelection: AiExerciseSelection,
  candidatePools: Map<string, LibraryExercise[]>,
): PlanDayGenerated[] {
  // Build a lookup of all candidate exercises by ID
  const exerciseById = new Map<string, LibraryExercise>();
  for (const exercises of candidatePools.values()) {
    for (const ex of exercises) {
      exerciseById.set(ex.id, ex);
    }
  }

  // Index AI selections by day_of_week
  const aiDayMap = new Map<
    number,
    { library_exercise_id: string; name: string }[]
  >();
  for (const aiDay of aiSelection.days) {
    aiDayMap.set(aiDay.day_of_week, aiDay.exercises);
  }

  return skeleton.map((day) => {
    if (day.day_type === 'rest' || day.exercise_slots.length === 0) {
      return {
        day_of_week: day.day_of_week,
        day_type: day.day_type,
        session_title: day.session_title,
        session_type: day.session_type,
        muscle_groups: [],
        exercises: [],
      };
    }

    const aiExercises = aiDayMap.get(day.day_of_week) ?? [];

    const exercises = aiExercises.map((aiEx, i) => {
      const libEx = exerciseById.get(aiEx.library_exercise_id);
      return {
        library_exercise_id: aiEx.library_exercise_id,
        external_id: libEx?.external_id ?? null,
        name: libEx?.name ?? aiEx.name,
        muscle_group: libEx?.muscle_group ?? '',
        equipment: libEx?.equipment ?? '',
        sets_display: day.exercise_slots[i]?.rep_scheme ?? '3 × 10',
      };
    });

    const muscleGroups = [...new Set(exercises.map((e) => e.muscle_group))];

    return {
      day_of_week: day.day_of_week,
      day_type: 'training' as const,
      session_title: day.session_title,
      session_type: day.session_type,
      muscle_groups: muscleGroups,
      exercises,
    };
  });
}

export function matchSkeletonToDays(
  skeleton: SkeletonDay[],
  exerciseLibrary: LibraryExercise[],
  recentExerciseIds: Set<string>,
  userLevel: string | null,
): PlanDayGenerated[] {
  return skeleton.map((day) => {
    if (day.day_type === 'rest' || day.exercise_slots.length === 0) {
      return {
        day_of_week: day.day_of_week,
        day_type: day.day_type,
        session_title: day.session_title,
        session_type: day.session_type,
        muscle_groups: [],
        exercises: [],
      };
    }

    const picks = matchExercisesToSlots(
      day.exercise_slots,
      exerciseLibrary,
      recentExerciseIds,
      userLevel,
    );

    const exercises = picks.map((pick, i) => ({
      library_exercise_id: pick.id,
      external_id: pick.external_id,
      name: pick.name,
      muscle_group: pick.muscle_group,
      equipment: pick.equipment,
      sets_display: day.exercise_slots[i].rep_scheme,
    }));

    const muscleGroups = [...new Set(exercises.map((e) => e.muscle_group))];

    return {
      day_of_week: day.day_of_week,
      day_type: 'training' as const,
      session_title: day.session_title,
      session_type: day.session_type,
      muscle_groups: muscleGroups,
      exercises,
    };
  });
}
