import { serializeExerciseSets } from './format-session';

describe('serializeExerciseSets', () => {
  it('returns [] for null / empty input', () => {
    expect(serializeExerciseSets(null)).toEqual([]);
    expect(serializeExerciseSets(undefined)).toEqual([]);
    expect(serializeExerciseSets([])).toEqual([]);
  });

  it('passes through the canonical shape unchanged', () => {
    const input = [
      { set_number: 1, weight: 60, weight_unit: 'kg', reps: 8, is_bodyweight: false },
      { set_number: 2, weight: 80, weight_unit: 'kg', reps: 5, is_bodyweight: false },
    ];
    expect(serializeExerciseSets(input as any)).toEqual(input);
  });

  it('synthesizes set_number when missing — covers the broken legacy shape', () => {
    // The bad version of synthesizeTargetSets persisted entries without
    // set_number. iOS's DashboardExerciseSet.setNumber is non-optional
    // → the entire dashboard decode threw → Home tab fell back to its
    // mock workout. This is the regression guard.
    const input = [
      { reps: 8, is_bodyweight: true },
      { reps: 8, is_bodyweight: true },
      { reps: 8, is_bodyweight: true },
    ] as any;
    const out = serializeExerciseSets(input);
    expect(out.map((s) => s.set_number)).toEqual([1, 2, 3]);
    expect(out.every((s) => s.weight === null)).toBe(true);
    expect(out.every((s) => s.weight_unit === 'kg')).toBe(true);
    expect(out.every((s) => s.is_bodyweight === true)).toBe(true);
  });

  it('accepts legacy weight_kg field', () => {
    const input = [
      { reps: 5, is_bodyweight: false, weight_kg: 100 },
    ] as any;
    const out = serializeExerciseSets(input);
    expect(out[0]).toMatchObject({ weight: 100, set_number: 1, reps: 5 });
  });

  it('coerces string weights (Prisma Decimal columns)', () => {
    const input = [
      { set_number: 1, weight: '87.5', weight_unit: 'kg', reps: 5, is_bodyweight: false },
    ] as any;
    expect(serializeExerciseSets(input)[0].weight).toBe(87.5);
  });

  it('coerces nullish weight to null without crashing', () => {
    const input = [
      { set_number: 1, weight: null, weight_unit: 'kg', reps: 10, is_bodyweight: true },
      { set_number: 2, reps: 10, is_bodyweight: true }, // no weight key at all
    ] as any;
    const out = serializeExerciseSets(input);
    expect(out[0].weight).toBe(null);
    expect(out[1].weight).toBe(null);
  });
});
