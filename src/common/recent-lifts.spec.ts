import {
  applyProgression,
  buildProgressedLadder,
  buildRecentLiftsLookup,
  computeRecentLifts,
  formatRecentLiftsBlock,
  progressSet,
  RecentLift,
} from './recent-lifts';

// Simulates the post-re-seed shape on prod: session_exercises retain
// external_id but their library_exercise_id was nulled when the seed
// script deleted + reinserted the system library with fresh UUIDs.
const SESSION_AFTER_RESEED = {
  completed_at: '2026-06-01T10:00:00.000Z',
  exercises: [
    {
      library_exercise_id: null, // nulled by re-seed
      external_id: 'bench-press-flat', // stable from upstream source
      name: 'Barbell Bench Press',
      muscle_group: 'Chest',
      exercise_sets: [
        { weight: 60, reps: 8, is_bodyweight: false },
        { weight: 80, reps: 5, is_bodyweight: false },
        { weight: 90, reps: 5, is_bodyweight: false },
      ],
    },
  ],
};

// The current library — fresh UUIDs, same external_ids.
const CURRENT_LIBRARY = [
  {
    id: 'new-uuid-bench',
    external_id: 'bench-press-flat',
    name: 'Barbell Bench Press',
  },
  {
    id: 'new-uuid-squat',
    external_id: 'back-squat',
    name: 'Barbell Back Squat',
  },
];

describe('recent-lifts external_id bridge', () => {
  it('computeRecentLifts surfaces external_id from session_exercise', () => {
    const lifts = computeRecentLifts([SESSION_AFTER_RESEED]);
    expect(lifts).toHaveLength(1);
    expect(lifts[0].externalId).toBe('bench-press-flat');
    expect(lifts[0].libraryExerciseId).toBe(null);
  });

  it('buildRecentLiftsLookup maps the lift to the CURRENT library row id', () => {
    const lifts = computeRecentLifts([SESSION_AFTER_RESEED]);
    const map = buildRecentLiftsLookup(lifts, CURRENT_LIBRARY);
    // The historical library_exercise_id is null but the bridge resolves
    // bench-press-flat -> new-uuid-bench. createWorkoutSession looks up
    // `recentLiftsMap.get(libEx.id)` after the strict-library match;
    // libEx.id is now new-uuid-bench, so the injection should fire.
    expect(map.get('new-uuid-bench')).toBeDefined();
    expect(map.get('new-uuid-bench')!.name).toBe('Barbell Bench Press');
  });

  it('buildRecentLiftsLookup still indexes legacy library_exercise_id when present', () => {
    const lifts = computeRecentLifts([
      {
        completed_at: '2026-06-01T10:00:00.000Z',
        exercises: [
          {
            library_exercise_id: 'legacy-uuid-bench',
            external_id: null,
            name: 'Bench Press',
            muscle_group: 'Chest',
            exercise_sets: [{ weight: 100, reps: 5, is_bodyweight: false }],
          },
        ],
      },
    ]);
    const map = buildRecentLiftsLookup(lifts, CURRENT_LIBRARY);
    expect(map.get('legacy-uuid-bench')).toBeDefined();
  });

  it('formatRecentLiftsBlock renders the live lib_id even when historical is null', () => {
    const lifts = computeRecentLifts([SESSION_AFTER_RESEED]);
    const block = formatRecentLiftsBlock(lifts, CURRENT_LIBRARY);
    // Without the library param this would render no lib_id (and the AI
    // would have to resolve by name, which fails after a catalog drift).
    expect(block).toContain('lib_id: new-uuid-bench');
    expect(block).not.toContain('lib_id: null');
  });

  it('formatRecentLiftsBlock without a library still works (legacy callers)', () => {
    const lifts = computeRecentLifts([SESSION_AFTER_RESEED]);
    const block = formatRecentLiftsBlock(lifts);
    expect(block).toContain('Barbell Bench Press');
    expect(block).not.toContain('lib_id:'); // null historical, no bridge → no lib ref
  });
});

describe('progressSet', () => {
  it('adds a rep below 12 reps (3\u00d78 \u2192 3\u00d79)', () => {
    expect(progressSet({ weight: 40, reps: 8, isBodyweight: false })).toEqual({
      weight: 40,
      reps: 9,
      isBodyweight: false,
    });
  });

  it('adds 2.5 kg and resets reps by 4 at 12+ reps (3\u00d712 @ 40 \u2192 3\u00d78 @ 42.5)', () => {
    expect(progressSet({ weight: 40, reps: 12, isBodyweight: false })).toEqual({
      weight: 42.5,
      reps: 8,
      isBodyweight: false,
    });
  });

  it('generalizes the reset to high-rep schemes (18 \u2192 14)', () => {
    expect(progressSet({ weight: 20, reps: 18, isBodyweight: false })).toEqual({
      weight: 22.5,
      reps: 14,
      isBodyweight: false,
    });
  });

  it('always adds a rep for bodyweight sets', () => {
    expect(progressSet({ weight: null, reps: 15, isBodyweight: true })).toEqual(
      { weight: null, reps: 16, isBodyweight: true },
    );
  });
});

describe('computeRecentLifts suggestedTopSet', () => {
  const session = (sets: any[]) => ({
    completed_at: '2026-07-01T10:00:00.000Z',
    exercises: [
      {
        library_exercise_id: 'lib-1',
        external_id: null,
        name: 'Bench Press',
        muscle_group: 'Chest',
        exercise_sets: sets,
      },
    ],
  });

  it('suggests +1 rep below 12 reps', () => {
    const [lift] = computeRecentLifts([
      session([{ weight: 80, reps: 8, is_bodyweight: false }]),
    ]);
    expect(lift.suggestedTopSet).toEqual({
      weight: 80,
      reps: 9,
      isBodyweight: false,
    });
  });

  it('suggests +2.5 kg with rep reset at 12+ reps', () => {
    const [lift] = computeRecentLifts([
      session([{ weight: 40, reps: 12, is_bodyweight: false }]),
    ]);
    expect(lift.suggestedTopSet).toEqual({
      weight: 42.5,
      reps: 8,
      isBodyweight: false,
    });
  });
});

describe('applyProgression', () => {
  const lift = (over: Partial<RecentLift> = {}): RecentLift => ({
    libraryExerciseId: 'lib-1',
    externalId: null,
    name: 'Bench Press',
    muscleGroup: 'Chest',
    lastDate: '2026-06-28',
    sets: [
      { weight: 60, reps: 10, isBodyweight: false },
      { weight: 80, reps: 8, isBodyweight: false },
      { weight: 80, reps: 8, isBodyweight: false },
    ],
    topSet: { weight: 80, reps: 8, isBodyweight: false },
    suggestedTopSet: { weight: 80, reps: 9, isBodyweight: false },
    ...over,
  });

  it('replaces an echoed ladder with the deterministic progression (rep bump)', () => {
    const result = applyProgression(
      [
        { weight_kg: 60, reps: 10 },
        { weight_kg: 80, reps: 8 },
        { weight_kg: 80, reps: 8 },
      ],
      lift(),
    );
    // Warm-up preserved, both working sets +1 rep
    expect(result[0]).toMatchObject({ weight_kg: 60, reps: 10 });
    expect(result[1]).toMatchObject({ weight_kg: 80, reps: 9 });
    expect(result[2]).toMatchObject({ weight_kg: 80, reps: 9 });
  });

  it('replaces even a differently-numbered same-structure ladder (app owns progression)', () => {
    const result = applyProgression(
      [
        { weight_kg: 60, reps: 10 },
        { weight_kg: 90, reps: 8 }, // AI over-eager bump
        { weight_kg: 90, reps: 8 },
      ],
      lift(),
    );
    expect(result[1]).toMatchObject({ weight_kg: 80, reps: 9 });
  });

  it('builds the ladder when the AI supplied nothing', () => {
    const result = applyProgression(undefined, lift());
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ weight_kg: 80, reps: 9 });
  });

  it('applies the weight bump + rep reset for high-rep working sets', () => {
    const highRep = lift({
      sets: [
        { weight: 40, reps: 12, isBodyweight: false },
        { weight: 40, reps: 12, isBodyweight: false },
        { weight: 40, reps: 12, isBodyweight: false },
      ],
      topSet: { weight: 40, reps: 12, isBodyweight: false },
      suggestedTopSet: { weight: 42.5, reps: 8, isBodyweight: false },
    });
    const result = applyProgression([], highRep);
    expect(result).toEqual([
      { weight_kg: 42.5, reps: 8, is_bodyweight: false },
      { weight_kg: 42.5, reps: 8, is_bodyweight: false },
      { weight_kg: 42.5, reps: 8, is_bodyweight: false },
    ]);
  });

  it('progresses bodyweight ladders by a rep', () => {
    const bwLift = lift({
      sets: [{ weight: null, reps: 12, isBodyweight: true }],
      topSet: { weight: null, reps: 12, isBodyweight: true },
      suggestedTopSet: { weight: null, reps: 13, isBodyweight: true },
    });
    const result = applyProgression(
      [{ reps: 12, is_bodyweight: true }],
      bwLift,
    );
    expect(result[0]).toMatchObject({ reps: 13, is_bodyweight: true });
  });

  it('keeps an intentional deload (top load < 95% of history)', () => {
    const sets = [
      { weight_kg: 40, reps: 10 },
      { weight_kg: 60, reps: 10 },
      { weight_kg: 60, reps: 10 },
    ];
    expect(applyProgression(sets, lift())).toEqual(sets);
  });

  it('keeps an intentional restructure (different set count)', () => {
    const fiveByFive = [
      { weight_kg: 80, reps: 5 },
      { weight_kg: 80, reps: 5 },
      { weight_kg: 80, reps: 5 },
      { weight_kg: 80, reps: 5 },
      { weight_kg: 80, reps: 5 },
    ];
    expect(applyProgression(fiveByFive, lift())).toEqual(fiveByFive);
  });

  it('passes cardio duration ladders through', () => {
    const sets = [{ reps: 0, duration_seconds: 1800 } as any];
    expect(applyProgression(sets, lift())).toEqual(sets);
  });
});

describe('buildProgressedLadder', () => {
  it('preserves warm-ups and progresses only working sets', () => {
    const result = buildProgressedLadder({
      libraryExerciseId: 'lib-1',
      externalId: null,
      name: 'Bench',
      muscleGroup: 'Chest',
      lastDate: '2026-07-01',
      sets: [
        { weight: 50, reps: 10, isBodyweight: false },
        { weight: 60, reps: 8, isBodyweight: false },
        { weight: 80, reps: 5, isBodyweight: false },
        { weight: 80, reps: 5, isBodyweight: false },
      ],
      topSet: { weight: 80, reps: 5, isBodyweight: false },
      suggestedTopSet: { weight: 80, reps: 6, isBodyweight: false },
    });
    expect(result).toEqual([
      { weight_kg: 50, reps: 10, is_bodyweight: false },
      { weight_kg: 60, reps: 8, is_bodyweight: false },
      { weight_kg: 80, reps: 6, is_bodyweight: false },
      { weight_kg: 80, reps: 6, is_bodyweight: false },
    ]);
  });
});
