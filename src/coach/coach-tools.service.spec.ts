import { Test, TestingModule } from '@nestjs/testing';
import { CoachToolsService } from './coach-tools.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { WorkoutOrchestratorService } from '../workouts/workout-orchestrator.service';
import { WeightSuggestionService } from '../home/weight-suggestion.service';
import { RecentLift } from '../common/recent-lifts';

/**
 * Direct test of the server-side target_sets injection that runs when
 * the AI ignored the PROGRESSIVE OVERLOAD prompt rule. We don't exercise
 * the OpenAI tool-call layer here — just the createWorkoutSession
 * transformation that turns recent-lifts into per-set rows.
 */
describe('CoachToolsService — target_sets safety net', () => {
  let service: CoachToolsService;
  let createdExerciseSets: any[] = [];

  const deadliftLib = {
    id: 'deadlift-lib-id',
    external_id: 'deadlift-ext',
    name: 'Barbell Deadlift',
    muscle_group: 'Back',
    equipment: 'Barbell',
  };

  // Mirrors the screenshot's actual ladder (8 sets, top 100×5).
  const deadliftLift: RecentLift = {
    libraryExerciseId: 'deadlift-lib-id',
    externalId: null,
    name: 'Barbell Deadlift',
    muscleGroup: 'Back',
    lastDate: '2026-06-03',
    sets: [
      { weight: 20, reps: 12, isBodyweight: false },
      { weight: 20, reps: 12, isBodyweight: false },
      { weight: 60, reps: 6, isBodyweight: false },
      { weight: 80, reps: 3, isBodyweight: false },
      { weight: 100, reps: 5, isBodyweight: false },
      { weight: 100, reps: 5, isBodyweight: false },
      { weight: 100, reps: 5, isBodyweight: false },
      { weight: 100, reps: 5, isBodyweight: false },
    ],
    topSet: { weight: 100, reps: 5, isBodyweight: false },
    // Reps >= 5 → +2.5 kg same reps per computeRecentLifts.
    suggestedTopSet: { weight: 102.5, reps: 5, isBodyweight: false },
  };

  beforeEach(async () => {
    createdExerciseSets = [];

    const prisma = {
      workoutSession: {
        create: jest.fn().mockImplementation(async (args: any) => {
          // Capture nested exercise_sets per exercise so we can assert
          // against them after the call.
          for (const ex of args.data.exercises.create) {
            createdExerciseSets.push({
              name: ex.name,
              sets_display: ex.sets_display,
              sets: ex.exercise_sets?.create ?? [],
            });
          }
          return { id: 'mock-session-id', exercises: [] };
        }),
      },
      onboardingData: {
        findFirst: jest.fn().mockResolvedValue({
          user_id: 'user-1',
          workout_duration: 60,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachToolsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlansService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: WorkoutOrchestratorService, useValue: {} },
        {
          provide: WeightSuggestionService,
          // Returns empty map so the synthesis branch surfaces null
          // weight when the recent-lifts path doesn't fire. Tests that
          // explicitly assert weights override this via mockReturnValue
          // before running.
          useValue: {
            suggestWeights: jest
              .fn()
              .mockResolvedValue(new Map<string, number | null>()),
          },
        },
      ],
    }).compile();

    service = module.get(CoachToolsService);
  });

  it('injects the full ladder when AI shipped no target_sets but exercise is in recent lifts', async () => {
    const args = {
      title: "Today's Session",
      type: 'strength',
      exercises: [
        {
          library_exercise_id: 'deadlift-lib-id',
          name: 'Barbell Deadlift',
          muscle_group: 'Back',
          // The bug the user reported — flat sets_display, no target_sets.
          sets_display: '8 × 12',
        },
      ],
      ai_message: 'Pull-focused workout',
    };
    const map = new Map<string, RecentLift>([
      ['deadlift-lib-id', deadliftLift],
    ]);

    // @ts-expect-error private — calling directly for the unit assertion
    await service.createWorkoutSession('user-1', args, [deadliftLib], map);

    expect(createdExerciseSets).toHaveLength(1);
    const persisted = createdExerciseSets[0];

    // Eight sets persisted (matches the prior ladder length).
    expect(persisted.sets).toHaveLength(8);

    // Warm-up ladder preserved one-for-one.
    expect(persisted.sets[0]).toMatchObject({ weight: 20, reps: 12 });
    expect(persisted.sets[1]).toMatchObject({ weight: 20, reps: 12 });
    expect(persisted.sets[2]).toMatchObject({ weight: 60, reps: 6 });
    expect(persisted.sets[3]).toMatchObject({ weight: 80, reps: 3 });

    // All FOUR 100×5 top-tier sets progress by a rep (deterministic
    // double progression: below 12 reps the app adds a rep, not weight).
    expect(persisted.sets[4]).toMatchObject({ weight: 100, reps: 6 });
    expect(persisted.sets[5]).toMatchObject({ weight: 100, reps: 6 });
    expect(persisted.sets[6]).toMatchObject({ weight: 100, reps: 6 });
    expect(persisted.sets[7]).toMatchObject({ weight: 100, reps: 6 });

    // sets_display reflects the ladder length and the TOP-LOAD set's
    // reps (100kg×6 after progression) — warm-up reps must not name the
    // pill, or a progressed session reads as "no change" on the card.
    expect(persisted.sets_display).toBe('8 × 6');
  });

  it('respects AI target_sets when present (no injection)', async () => {
    const aiLadder = [
      { weight_kg: 50, reps: 10 },
      { weight_kg: 70, reps: 6 },
      { weight_kg: 90, reps: 3 },
      { weight_kg: 110, reps: 5 },
    ];
    const args = {
      title: 'Quick Pull',
      type: 'strength',
      exercises: [
        {
          library_exercise_id: 'deadlift-lib-id',
          name: 'Barbell Deadlift',
          muscle_group: 'Back',
          sets_display: '4 × 5',
          target_sets: aiLadder,
        },
      ],
      ai_message: 'Going heavier',
    };
    const map = new Map<string, RecentLift>([
      ['deadlift-lib-id', deadliftLift],
    ]);

    // @ts-expect-error private
    await service.createWorkoutSession('user-1', args, [deadliftLib], map);

    const persisted = createdExerciseSets[0];
    expect(persisted.sets).toHaveLength(4);
    expect(persisted.sets[3]).toMatchObject({ weight: 110, reps: 5 });
  });

  it('synthesizes per-set rows for novel exercises via sets_display + weight suggestion', async () => {
    const args = {
      title: 'Pull Day',
      type: 'strength',
      exercises: [
        {
          library_exercise_id: 'deadlift-lib-id',
          name: 'Barbell Deadlift',
          muscle_group: 'Back',
          sets_display: '3 × 10',
        },
      ],
      ai_message: 'First time doing this',
    };
    // Empty recent-lifts → the new synthesis branch fires, parsing
    // sets_display and pulling a weight from WeightSuggestionService.
    const map = new Map<string, RecentLift>();

    // @ts-expect-error private
    await service.createWorkoutSession('user-1', args, [deadliftLib], map);

    const persisted = createdExerciseSets[0];
    // 3 sets × 10 reps — matches sets_display.
    expect(persisted.sets).toHaveLength(3);
    // Barbell equipment → WEIGHTED_EQUIPMENT override forces
    // is_bodyweight=false regardless of what the AI sent.
    expect(persisted.sets.every((s: any) => s.is_bodyweight === false)).toBe(
      true,
    );
    // Every set carries the expected rep count.
    expect(persisted.sets.every((s: any) => s.reps === 10)).toBe(true);
    // sets_display stays "3 × 10" since the synthesized ladder is flat.
    expect(persisted.sets_display).toBe('3 × 10');
  });

  it('does not flag weighted equipment as bodyweight even if AI did', async () => {
    const args = {
      title: 'Push Day',
      type: 'strength',
      exercises: [
        {
          library_exercise_id: 'deadlift-lib-id', // reuse the barbell fixture
          name: 'Barbell Deadlift',
          muscle_group: 'Back',
          sets_display: '3 × 5',
          // AI mistakenly flagged a barbell lift as bodyweight.
          target_sets: [
            { reps: 5, is_bodyweight: true },
            { reps: 5, is_bodyweight: true },
            { reps: 5, is_bodyweight: true },
          ],
        },
      ],
      ai_message: 'oops',
    };
    const map = new Map<string, RecentLift>();

    // @ts-expect-error private
    await service.createWorkoutSession('user-1', args, [deadliftLib], map);

    const persisted = createdExerciseSets[0];
    expect(persisted.sets).toHaveLength(3);
    // Override forces FALSE because libEx.equipment === 'Barbell'.
    expect(persisted.sets.every((s: any) => s.is_bodyweight === false)).toBe(
      true,
    );
  });
});
