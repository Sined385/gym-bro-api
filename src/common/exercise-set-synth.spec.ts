import {
  parseSetsDisplay,
  synthesizeTargetSets,
  synthesizeCardioTargetSets,
  isBodyweightEquipment,
  isCardioCategory,
  isWeightedEquipment,
  resolveIsCardio,
  isHiddenCardio,
} from './exercise-set-synth';

describe('exercise-set-synth', () => {
  describe('parseSetsDisplay', () => {
    it('parses "3 × 10"', () => {
      expect(parseSetsDisplay('3 × 10')).toEqual({ setCount: 3, reps: 10 });
    });
    it('parses ASCII variant "4 x 8"', () => {
      expect(parseSetsDisplay('4 x 8')).toEqual({ setCount: 4, reps: 8 });
    });
    it('parses time-style "2 × 30 sec"', () => {
      expect(parseSetsDisplay('2 × 30 sec')).toEqual({ setCount: 2, reps: 30 });
    });
    it('falls back when input is null', () => {
      expect(parseSetsDisplay(null)).toEqual({ setCount: 3, reps: 10 });
    });
    it('falls back when unparseable', () => {
      expect(parseSetsDisplay('AMRAP')).toEqual({ setCount: 3, reps: 10 });
    });
  });

  describe('equipment classifiers', () => {
    it.each(['Barbell', 'Dumbbells', 'Machine', 'Cable', 'Kettlebells'])(
      '%s is weighted',
      (eq) => {
        expect(isWeightedEquipment(eq)).toBe(true);
        expect(isBodyweightEquipment(eq)).toBe(false);
      },
    );
    it.each(['Bodyweight', 'Bands'])('%s is bodyweight', (eq) => {
      expect(isBodyweightEquipment(eq)).toBe(true);
      expect(isWeightedEquipment(eq)).toBe(false);
    });
    it('Other is neither', () => {
      expect(isWeightedEquipment('Other')).toBe(false);
      expect(isBodyweightEquipment('Other')).toBe(false);
    });
    it('null is neither', () => {
      expect(isWeightedEquipment(null)).toBe(false);
      expect(isBodyweightEquipment(null)).toBe(false);
    });
  });

  describe('synthesizeTargetSets', () => {
    it('returns canonical persisted shape — set_number, weight, weight_unit', () => {
      // This shape is the source-of-truth contract: it must match what
      // serializeExerciseSets reads on the way out and what iOS's
      // DashboardExerciseSet decodes (setNumber, weight, weightUnit,
      // reps, isBodyweight after convertFromSnakeCase). Previous
      // version of this helper returned `{ weight_kg, reps,
      // is_bodyweight }` which got silently dropped by iOS Codable
      // because setNumber is non-optional and was missing.
      const out = synthesizeTargetSets({
        setsDisplay: '3 × 10',
        equipment: 'Barbell',
        suggestedWeight: 60,
      });
      expect(out).toEqual([
        {
          set_number: 1,
          weight: 60,
          weight_unit: 'kg',
          reps: 10,
          is_bodyweight: false,
        },
        {
          set_number: 2,
          weight: 60,
          weight_unit: 'kg',
          reps: 10,
          is_bodyweight: false,
        },
        {
          set_number: 3,
          weight: 60,
          weight_unit: 'kg',
          reps: 10,
          is_bodyweight: false,
        },
      ]);
    });

    it('bodyweight equipment → no weight, is_bodyweight=true', () => {
      const out = synthesizeTargetSets({
        setsDisplay: '4 × 8',
        equipment: 'Bodyweight',
        suggestedWeight: 50, // ignored — equipment wins
      });
      expect(out).toHaveLength(4);
      for (const s of out) {
        expect(s.weight).toBe(null);
        expect(s.is_bodyweight).toBe(true);
        expect(s.weight_unit).toBe('kg');
      }
    });

    it('weighted equipment with null suggestion → weight: null, is_bodyweight: false', () => {
      const out = synthesizeTargetSets({
        setsDisplay: '3 × 10',
        equipment: 'Cable',
        suggestedWeight: null,
      });
      expect(
        out.every((s) => s.weight === null && s.is_bodyweight === false),
      ).toBe(true);
    });

    it('every entry carries a strictly-increasing set_number', () => {
      const out = synthesizeTargetSets({
        setsDisplay: '5 × 5',
        equipment: 'Barbell',
        suggestedWeight: 100,
      });
      expect(out.map((s) => s.set_number)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('synthesizeCardioTargetSets', () => {
    it('emits a single duration-only set', () => {
      const out = synthesizeCardioTargetSets({ targetDurationMinutes: 30 });
      expect(out).toEqual([
        {
          set_number: 1,
          weight: null,
          weight_unit: 'kg',
          reps: 0,
          is_bodyweight: false,
          duration_seconds: 1800,
          distance_meters: null,
          target_speed_kmh: null,
        },
      ]);
    });

    it('carries through a target speed when supplied', () => {
      const out = synthesizeCardioTargetSets({
        targetDurationMinutes: 30,
        targetSpeedKmh: 5,
      });
      expect(out[0].target_speed_kmh).toBe(5);
    });

    it('drops an absurd / non-positive target speed to null', () => {
      expect(
        synthesizeCardioTargetSets({ targetSpeedKmh: 0 })[0].target_speed_kmh,
      ).toBeNull();
      expect(
        synthesizeCardioTargetSets({ targetSpeedKmh: 250 })[0].target_speed_kmh,
      ).toBeNull();
    });

    it('falls back to 30 min when target is missing / zero / absurd', () => {
      expect(
        synthesizeCardioTargetSets({ targetDurationMinutes: null })[0]
          .duration_seconds,
      ).toBe(1800);
      expect(
        synthesizeCardioTargetSets({ targetDurationMinutes: 0 })[0]
          .duration_seconds,
      ).toBe(1800);
      expect(
        synthesizeCardioTargetSets({ targetDurationMinutes: 99999 })[0]
          .duration_seconds,
      ).toBe(1800);
    });
  });

  describe('isCardioCategory', () => {
    it.each(['cardio', 'Cardio', 'CARDIO'])('matches %s', (c) => {
      expect(isCardioCategory(c)).toBe(true);
    });
    it.each(['strength', 'stretching', null, undefined, ''])(
      'rejects %s',
      (c) => {
        expect(isCardioCategory(c as any)).toBe(false);
      },
    );
  });
});

describe('resolveIsCardio', () => {
  it('treats category=cardio as cardio regardless of AI hint', () => {
    expect(resolveIsCardio('cardio', false)).toBe(true);
    expect(resolveIsCardio('cardio', undefined)).toBe(true);
  });

  it('NEVER cardio-ifies an explicit non-cardio category, even if AI says is_cardio', () => {
    expect(resolveIsCardio('plyometrics', true)).toBe(false);
    expect(resolveIsCardio('strength', true)).toBe(false);
  });

  it('honors the AI hint only when the row has no explicit category', () => {
    expect(resolveIsCardio(null, true)).toBe(true);
    expect(resolveIsCardio('', true)).toBe(true);
    expect(resolveIsCardio(undefined, true)).toBe(true);
    expect(resolveIsCardio(null, false)).toBe(false);
  });
});

describe('isHiddenCardio', () => {
  it('hides cardio types outside the shipped set (by category or muscle_group)', () => {
    expect(
      isHiddenCardio({ category: 'cardio', external_id: 'Prowler_Sprint' }),
    ).toBe(true);
    expect(
      isHiddenCardio({ muscle_group: 'Cardio', external_id: 'Skating' }),
    ).toBe(true);
  });

  it('keeps the shipped cardio set visible', () => {
    expect(
      isHiddenCardio({ category: 'cardio', external_id: 'Walking_Treadmill' }),
    ).toBe(false);
    expect(
      isHiddenCardio({ category: 'cardio', external_id: 'Rowing_Stationary' }),
    ).toBe(false);
    expect(
      isHiddenCardio({
        muscle_group: 'Cardio',
        external_id: 'Stairmaster',
      }),
    ).toBe(false);
  });

  it('never hides user-created cardio (custom exercises)', () => {
    expect(
      isHiddenCardio({
        muscle_group: 'Cardio',
        external_id: null,
        is_system: false,
      }),
    ).toBe(false);
    expect(
      isHiddenCardio({
        category: 'cardio',
        external_id: null,
        user_id: 'user-1',
      }),
    ).toBe(false);
  });

  it('never hides non-cardio exercises', () => {
    expect(
      isHiddenCardio({
        category: 'strength',
        external_id: 'Barbell_Bench_Press',
      }),
    ).toBe(false);
    expect(
      isHiddenCardio({ muscle_group: 'Chest', external_id: 'Push_Up' }),
    ).toBe(false);
  });
});
