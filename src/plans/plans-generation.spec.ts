import { PlansAiService } from './plans-ai.service';
import {
  assembleFromAiSelection,
  SkeletonDay,
  LibraryExercise,
  AiExerciseSelection,
} from './exercise-matcher';

describe('PlansAiService helpers', () => {
  const service = new PlansAiService(
    {} as any, // prisma — unused by the helpers under test
    { get: () => undefined } as any,
    {} as any, // openai
    {} as any, // aiUsage
  );

  describe('scaleFrequency', () => {
    const scale = (freq: number, days: number): number =>
      (service as any).scaleFrequency(freq, days);

    it('keeps the full-week frequency unchanged', () => {
      expect(scale(3, 7)).toBe(3);
      expect(scale(5, 7)).toBe(5);
    });

    it('never scales a positive frequency down to zero (Sunday onboarding)', () => {
      expect(scale(3, 1)).toBe(1);
      expect(scale(2, 2)).toBe(1);
    });

    it('clamps to the number of remaining days', () => {
      expect(scale(7, 3)).toBe(3);
    });

    it('returns 0 only when frequency is 0', () => {
      expect(scale(0, 5)).toBe(0);
    });
  });

  describe('validateSkeleton', () => {
    const validate = (days: unknown, startDow: number): SkeletonDay[] | null =>
      (service as any).validateSkeleton(days, startDow);

    const trainingDay = (dow: number): any => ({
      day_of_week: dow,
      day_type: 'training',
      session_title: 'Day',
      session_type: 'strength',
      exercise_slots: [
        { muscle_group: 'Chest', rep_scheme: '3 × 10', focus: 'compound' },
      ],
    });
    const restDay = (dow: number): any => ({
      day_of_week: dow,
      day_type: 'rest',
      exercise_slots: [],
    });

    it('accepts a full valid week and sorts by day_of_week', () => {
      const week = [restDay(1), trainingDay(0), ...[2, 3, 4, 5, 6].map(restDay)];
      const result = validate(week, 0);
      expect(result).not.toBeNull();
      expect(result!.map((d) => d.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('rejects a wrong day count', () => {
      expect(validate([trainingDay(0)], 0)).toBeNull();
    });

    it('rejects days before the start of the window', () => {
      const week = [trainingDay(0), restDay(4), restDay(5), restDay(6)];
      expect(validate(week, 3)).toBeNull();
    });

    it('rejects duplicate day_of_week', () => {
      const week = [trainingDay(0), trainingDay(0), ...[2, 3, 4, 5, 6].map(restDay)];
      expect(validate(week, 0)).toBeNull();
    });

    it('rejects a training day without slots', () => {
      const bad = { ...trainingDay(0), exercise_slots: [] };
      const week = [bad, ...[1, 2, 3, 4, 5, 6].map(restDay)];
      expect(validate(week, 0)).toBeNull();
    });

    it('strips a malformed alt_session instead of failing the skeleton', () => {
      const rest = { ...restDay(1), alt_session: { exercise_slots: 'nope' } };
      const week = [trainingDay(0), rest, ...[2, 3, 4, 5, 6].map(restDay)];
      const result = validate(week, 0);
      expect(result).not.toBeNull();
      expect(result![1].alt_session).toBeUndefined();
    });

    it('defaults a missing rep_scheme instead of failing', () => {
      const day = trainingDay(0);
      delete day.exercise_slots[0].rep_scheme;
      const week = [day, ...[1, 2, 3, 4, 5, 6].map(restDay)];
      const result = validate(week, 0);
      expect(result![0].exercise_slots[0].rep_scheme).toBe('3 × 10');
    });
  });
});

describe('assembleFromAiSelection partial salvage', () => {
  const lib = (
    id: string,
    name: string,
    group: string,
  ): LibraryExercise => ({
    id,
    name,
    muscle_group: group,
    equipment: 'Barbell',
    external_id: `ext-${id}`,
    level: 'intermediate',
    mechanic: 'compound',
  });

  const pools = new Map<string, LibraryExercise[]>([
    ['Chest', [lib('c1', 'Bench Press', 'Chest'), lib('c2', 'Incline Press', 'Chest')]],
    ['Back', [lib('b1', 'Barbell Row', 'Back'), lib('b2', 'Pull-Up', 'Back')]],
  ]);

  const skeleton: SkeletonDay[] = [
    {
      day_of_week: 0,
      day_type: 'training',
      session_title: 'Push',
      session_type: 'strength',
      exercise_slots: [
        { muscle_group: 'Chest', rep_scheme: '4 × 8', focus: 'compound' },
      ],
    },
    {
      day_of_week: 2,
      day_type: 'training',
      session_title: 'Pull',
      session_type: 'strength',
      exercise_slots: [
        { muscle_group: 'Back', rep_scheme: '3 × 10', focus: 'compound' },
      ],
    },
  ];

  it('uses the AI pick where present and matcher-fills dropped days', () => {
    // Selection only covers day 0 — day 2 was dropped by validation.
    const selection: AiExerciseSelection = {
      days: [
        {
          day_of_week: 0,
          exercises: [
            {
              library_exercise_id: 'c1',
              name: 'Bench Press',
              target_sets: [{ weight_kg: 80, reps: 8 }],
            },
          ],
        },
      ],
    };

    const result = assembleFromAiSelection(skeleton, selection, pools);

    const day0 = result.find((d) => d.day_of_week === 0)!;
    expect(day0.exercises[0].library_exercise_id).toBe('c1');
    expect(day0.exercises[0].target_sets).toEqual([{ weight_kg: 80, reps: 8 }]);

    // Day 2 got a deterministic fill from the Back pool, not an empty day.
    const day2 = result.find((d) => d.day_of_week === 2)!;
    expect(day2.exercises).toHaveLength(1);
    expect(['b1', 'b2']).toContain(day2.exercises[0].library_exercise_id);
    expect(day2.exercises[0].sets_display).toBe('3 × 10');
  });
});
