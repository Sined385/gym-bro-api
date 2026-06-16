import { serializeExerciseSets } from './format-session';

describe('serializeExerciseSets', () => {
  it('returns [] for null / empty input', () => {
    expect(serializeExerciseSets(null)).toEqual([]);
    expect(serializeExerciseSets(undefined)).toEqual([]);
    expect(serializeExerciseSets([])).toEqual([]);
  });

  it('passes through the canonical shape unchanged (strength sets get null cardio fields)', () => {
    const input = [
      { set_number: 1, weight: 60, weight_unit: 'kg', reps: 8, is_bodyweight: false },
      { set_number: 2, weight: 80, weight_unit: 'kg', reps: 5, is_bodyweight: false },
    ];
    const out = serializeExerciseSets(input as any);
    expect(out).toEqual([
      { ...input[0], duration_seconds: null, distance_meters: null },
      { ...input[1], duration_seconds: null, distance_meters: null },
    ]);
  });

  it('round-trips a cardio set (duration_seconds + distance_meters preserved, no weight/reps)', () => {
    const input = [
      {
        set_number: 1,
        weight: null,
        reps: 0,
        is_bodyweight: false,
        duration_seconds: 1800,
        distance_meters: 5000,
      },
    ];
    const out = serializeExerciseSets(input as any);
    expect(out[0]).toEqual({
      set_number: 1,
      weight: null,
      weight_unit: 'kg',
      reps: 0,
      is_bodyweight: false,
      duration_seconds: 1800,
      distance_meters: 5000,
    });
  });

  it('drops negative or non-numeric duration / distance to null', () => {
    const input = [
      {
        set_number: 1,
        weight: null,
        reps: 0,
        duration_seconds: -10,
        distance_meters: 'oops',
      },
    ];
    const out = serializeExerciseSets(input as any);
    expect(out[0].duration_seconds).toBe(null);
    expect(out[0].distance_meters).toBe(null);
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

  it('coerces Decimal-like objects (Prisma @prisma/adapter-pg path)', () => {
    // Prisma Decimal columns come back as Decimal instances (typeof
    // 'object'). A plain string-check misses them and JSON.stringify
    // silently turns them into strings at response time — iOS then
    // throws typeMismatch(Double, found String).
    class FakeDecimal {
      constructor(private value: number) {}
      valueOf() {
        return this.value;
      }
      toJSON() {
        return String(this.value);
      }
    }
    const input = [
      { set_number: 1, weight: new FakeDecimal(60), weight_unit: 'kg', reps: 8, is_bodyweight: false },
    ] as any;
    const out = serializeExerciseSets(input);
    expect(typeof out[0].weight).toBe('number');
    expect(out[0].weight).toBe(60);
  });

  it('drops NaN / Infinity to null instead of letting them reach iOS', () => {
    const input = [
      { set_number: 1, weight: 'oops', reps: 5, is_bodyweight: false },
      { set_number: 2, weight: Infinity, reps: 5, is_bodyweight: false },
    ] as any;
    const out = serializeExerciseSets(input);
    expect(out[0].weight).toBe(null);
    expect(out[1].weight).toBe(null);
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
