import {
  parseSetsDisplay,
  synthesizeTargetSets,
  isBodyweightEquipment,
  isWeightedEquipment,
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
        { set_number: 1, weight: 60, weight_unit: 'kg', reps: 10, is_bodyweight: false },
        { set_number: 2, weight: 60, weight_unit: 'kg', reps: 10, is_bodyweight: false },
        { set_number: 3, weight: 60, weight_unit: 'kg', reps: 10, is_bodyweight: false },
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
      expect(out.every((s) => s.weight === null && s.is_bodyweight === false)).toBe(true);
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
});
