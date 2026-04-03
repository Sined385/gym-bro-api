// Pure functions — no DI, importable by PlansService and CoachService.

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
