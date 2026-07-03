import {
  buildRecentLiftsLookup,
  computeRecentLifts,
  enforceProgression,
  formatRecentLiftsBlock,
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

describe('enforceProgression', () => {
  const lift = (over: Partial<RecentLift> = {}): RecentLift => ({
    libraryExerciseId: 'lib-1',
    externalId: null,
    name: 'Bench Press',
    muscleGroup: 'Chest',
    lastDate: '2026-06-28',
    sets: [
      { weight: 60, reps: 10, isBodyweight: false },
      { weight: 80, reps: 8, isBodyweight: false },
    ],
    topSet: { weight: 80, reps: 8, isBodyweight: false },
    suggestedTopSet: { weight: 82.5, reps: 8, isBodyweight: false },
    ...over,
  });

  it('bumps a ladder that echoes last session verbatim', () => {
    const result = enforceProgression(
      [
        { weight_kg: 60, reps: 10 },
        { weight_kg: 80, reps: 8 },
        { weight_kg: 80, reps: 8 },
      ],
      lift(),
    );
    expect(result[0]).toEqual({ weight_kg: 60, reps: 10 });
    // Every set tied at the echoed top gets the suggested value
    expect(result[1]).toMatchObject({ weight_kg: 82.5, reps: 8 });
    expect(result[2]).toMatchObject({ weight_kg: 82.5, reps: 8 });
  });

  it('leaves an already-progressed ladder untouched', () => {
    const sets = [
      { weight_kg: 60, reps: 10 },
      { weight_kg: 85, reps: 6 },
    ];
    expect(enforceProgression(sets, lift())).toEqual(sets);
  });

  it('leaves a same-load-more-reps ladder untouched', () => {
    const sets = [{ weight_kg: 80, reps: 10 }];
    expect(enforceProgression(sets, lift())).toEqual(sets);
  });

  it('leaves a deload untouched', () => {
    const sets = [
      { weight_kg: 50, reps: 12 },
      { weight_kg: 65, reps: 10 },
    ];
    expect(enforceProgression(sets, lift())).toEqual(sets);
  });

  it('bumps reps on an echoed bodyweight ladder', () => {
    const bwLift = lift({
      sets: [{ weight: null, reps: 12, isBodyweight: true }],
      topSet: { weight: null, reps: 12, isBodyweight: true },
      suggestedTopSet: { weight: null, reps: 13, isBodyweight: true },
    });
    const result = enforceProgression(
      [{ reps: 12, is_bodyweight: true }],
      bwLift,
    );
    expect(result[0]).toMatchObject({ reps: 13, is_bodyweight: true });
  });

  it('skips cardio duration ladders', () => {
    const sets = [{ reps: 0, duration_seconds: 1800 } as any];
    expect(enforceProgression(sets, lift())).toEqual(sets);
  });
});
