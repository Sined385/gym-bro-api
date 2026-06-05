import {
  buildRecentLiftsLookup,
  computeRecentLifts,
  formatRecentLiftsBlock,
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
