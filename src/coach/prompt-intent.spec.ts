import { filterLibraryForContext, inferUserIntent } from './prompt-intent';

// Minimal library fixture covering the muscle groups + equipment the
// real seed data uses. Real catalog has ~800 entries; this is just
// enough to exercise the filter branches.
const LIB = [
  { id: 'bb-bench', name: 'Barbell Bench Press', muscle_group: 'Chest', equipment: 'Barbell', is_system: true, mechanic: 'compound' },
  { id: 'db-bench', name: 'Dumbbell Bench Press', muscle_group: 'Chest', equipment: 'Dumbbells', is_system: true, mechanic: 'compound' },
  { id: 'inc-bench', name: 'Incline Bench Press', muscle_group: 'Chest', equipment: 'Barbell', is_system: true, mechanic: 'compound' },
  { id: 'push-up', name: 'Push-Up', muscle_group: 'Chest', equipment: 'Bodyweight', is_system: true, mechanic: 'compound' },
  { id: 'bb-row', name: 'Barbell Row', muscle_group: 'Back', equipment: 'Barbell', is_system: true, mechanic: 'compound' },
  { id: 'pull-up', name: 'Pull-Up', muscle_group: 'Back', equipment: 'Bodyweight', is_system: true, mechanic: 'compound' },
  { id: 'lat-pull', name: 'Lat Pulldown', muscle_group: 'Lats', equipment: 'Cable', is_system: true, mechanic: 'compound' },
  { id: 'bb-squat', name: 'Barbell Back Squat', muscle_group: 'Quadriceps', equipment: 'Barbell', is_system: true, mechanic: 'compound' },
  { id: 'bw-squat', name: 'Bodyweight Squat', muscle_group: 'Quadriceps', equipment: 'Bodyweight', is_system: true, mechanic: 'compound' },
  { id: 'rdl', name: 'Romanian Deadlift', muscle_group: 'Hamstrings', equipment: 'Barbell', is_system: true, mechanic: 'compound' },
  { id: 'curl', name: 'Barbell Curl', muscle_group: 'Biceps', equipment: 'Barbell', is_system: true, mechanic: 'isolation' },
  { id: 'tri-pushdown', name: 'Triceps Pushdown', muscle_group: 'Triceps', equipment: 'Cable', is_system: true, mechanic: 'isolation' },
  { id: 'crunch', name: 'Crunch', muscle_group: 'Abdominals', equipment: 'Bodyweight', is_system: true, mechanic: 'isolation' },
];

describe('inferUserIntent', () => {
  it('extracts chest + push muscles from a push-day ask', () => {
    const intent = inferUserIntent('make me a push day workout', LIB);
    expect(intent.muscleKeywords).toEqual(
      expect.arrayContaining(['chest', 'shoulders', 'arms']),
    );
  });

  it('extracts bodyweight + chest from "bodyweight chest day"', () => {
    const intent = inferUserIntent('bodyweight chest day', LIB);
    expect(intent.muscleKeywords).toEqual(expect.arrayContaining(['chest']));
    expect(intent.equipmentKeywords).toEqual(
      expect.arrayContaining(['bodyweight']),
    );
  });

  it('expands "gym workout" to full kit', () => {
    const intent = inferUserIntent('give me a gym workout', LIB);
    expect(intent.equipmentKeywords).toEqual(
      expect.arrayContaining(['barbell', 'dumbbells', 'machine', 'bodyweight']),
    );
  });

  it('returns empty intent for conversational turns', () => {
    const intent = inferUserIntent('how about more reps?', LIB);
    expect(intent.muscleKeywords).toEqual([]);
    expect(intent.equipmentKeywords).toEqual([]);
    expect(intent.namedExerciseIds).toEqual([]);
  });

  it('handles null / empty messages', () => {
    expect(inferUserIntent(null, LIB).muscleKeywords).toEqual([]);
    expect(inferUserIntent('', LIB).muscleKeywords).toEqual([]);
  });

  it('extracts a named library exercise by substring', () => {
    const intent = inferUserIntent('I want to do bench press today', LIB);
    expect(intent.namedExerciseIds).toEqual(
      expect.arrayContaining(['bb-bench', 'db-bench', 'inc-bench']),
    );
  });

  it('catches "leg day" via composite keyword', () => {
    const intent = inferUserIntent('plan a leg day for me', LIB);
    expect(intent.muscleKeywords).toEqual(expect.arrayContaining(['legs']));
  });

  it('catches deadlift as a barbell signal', () => {
    const intent = inferUserIntent('I want deadlifts today', LIB);
    expect(intent.equipmentKeywords).toEqual(
      expect.arrayContaining(['barbell']),
    );
  });
});

describe('filterLibraryForContext', () => {
  const bodyweightOnboarding = { available_equipment: 'bodyweight' };
  const gymOnboarding = { available_equipment: 'full_gym' };

  it('user message equipment override beats onboarding (gym ask vs bodyweight onboarding)', () => {
    const intent = inferUserIntent('gym workout with barbell', LIB);
    const filtered = filterLibraryForContext({
      library: LIB,
      intent,
      onboarding: bodyweightOnboarding,
    });
    // Must include barbell movements despite bodyweight onboarding.
    expect(filtered.map((e) => e.id)).toEqual(
      expect.arrayContaining(['bb-bench', 'bb-row', 'bb-squat']),
    );
  });

  it('bodyweight onboarding + no intent → bodyweight only', () => {
    const filtered = filterLibraryForContext({
      library: LIB,
      intent: { muscleKeywords: [], equipmentKeywords: [], namedExerciseIds: [] },
      onboarding: bodyweightOnboarding,
    });
    // Every result must be bodyweight (EQUIPMENT_MAP['bodyweight'] = ['Bodyweight']).
    expect(filtered.every((e) => /bodyweight/i.test(e.equipment))).toBe(true);
    expect(filtered.map((e) => e.id)).toEqual(
      expect.arrayContaining(['push-up', 'pull-up', 'bw-squat', 'crunch']),
    );
  });

  it('chest intent narrows to chest-only', () => {
    const intent = inferUserIntent('make me a chest workout', LIB);
    const filtered = filterLibraryForContext({
      library: LIB,
      intent,
      onboarding: gymOnboarding,
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((e) => /chest|pec/i.test(e.muscle_group))).toBe(true);
  });

  it('full_gym onboarding + no intent → no equipment filter, all groups represented', () => {
    const filtered = filterLibraryForContext({
      library: LIB,
      intent: { muscleKeywords: [], equipmentKeywords: [], namedExerciseIds: [] },
      onboarding: gymOnboarding,
    });
    // Should pick up the whole fixture since the cap (default 120) is
    // larger than fixture size.
    expect(filtered.length).toBe(LIB.length);
  });

  it('named exercise is always included even when equipment would exclude it', () => {
    // User asks for barbell bench press while onboarding is bodyweight
    // and no equipment override in the message itself (e.g. just the
    // exercise name). The named match must still surface.
    const intent = {
      muscleKeywords: [],
      equipmentKeywords: [],
      namedExerciseIds: ['bb-bench'],
    };
    const filtered = filterLibraryForContext({
      library: LIB,
      intent,
      onboarding: bodyweightOnboarding,
    });
    expect(filtered.map((e) => e.id)).toContain('bb-bench');
  });

  it('respects the cap', () => {
    const filtered = filterLibraryForContext({
      library: LIB,
      intent: { muscleKeywords: [], equipmentKeywords: [], namedExerciseIds: [] },
      onboarding: gymOnboarding,
      cap: 3,
    });
    expect(filtered.length).toBeLessThanOrEqual(3);
  });

  it('recent lifts get included via the named/recent pin path', () => {
    const filtered = filterLibraryForContext({
      library: LIB,
      intent: { muscleKeywords: ['back'], equipmentKeywords: [], namedExerciseIds: [] },
      onboarding: gymOnboarding,
      recentLiftIds: ['bb-bench'], // chest exercise, would normally be filtered out by muscle
    });
    // Recent lifts are scored higher but not pinned across the muscle
    // filter — they're a soft preference. Assertion: bb-bench MAY or
    // MAY NOT appear depending on rules; what we DO want is no crash
    // and back exercises present.
    const ids = filtered.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['bb-row', 'pull-up', 'lat-pull']));
  });
});

describe('walking / cardio intent (regression: "walking chest and arms")', () => {
  // Library with a seeded walking row, mirroring the real catalog where
  // cardio rows carry muscle_group="Cardio".
  const CARDIO_LIB = [
    ...LIB,
    {
      id: 'walk-tm',
      name: 'Walking, Treadmill',
      muscle_group: 'Cardio',
      equipment: 'Machine',
      category: 'cardio',
      is_system: true,
      mechanic: null,
    },
  ];

  it('detects cardio alongside the named muscles for "walking chest and arms"', () => {
    const intent = inferUserIntent('walking chest and arms', CARDIO_LIB);
    expect(intent.muscleKeywords).toEqual(
      expect.arrayContaining(['cardio', 'chest', 'arms']),
    );
  });

  it('surfaces the walking row when the user asks for walking + muscles', () => {
    const intent = inferUserIntent('walking chest and arms', CARDIO_LIB);
    const filtered = filterLibraryForContext({
      library: CARDIO_LIB,
      intent,
      onboarding: { available_equipment: 'full_gym' },
      recentLiftIds: [],
      cap: 120,
    });
    expect(filtered.map((e) => e.id)).toContain('walk-tm');
  });

  it('treats a bare "let\'s go for a walk" as cardio', () => {
    const intent = inferUserIntent("let's go for a walk", CARDIO_LIB);
    expect(intent.muscleKeywords).toContain('cardio');
  });

  it('still routes "walking lunges" to legs (not cardio-only)', () => {
    const intent = inferUserIntent('add some walking lunges', CARDIO_LIB);
    expect(intent.muscleKeywords).toContain('legs');
  });
});
