import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PlansAiService } from './plans-ai.service';
import { WeightSuggestionService } from '../weight-suggestion/weight-suggestion.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  matchSkeletonToDays,
  filterCandidates,
  assembleFromAiSelection,
  SkeletonDay,
} from './exercise-matcher';
import { getWeekStart, toMondayDow } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { getRecentExerciseIds, getRecentExerciseNames } from './plan-helpers';

export interface WorkoutSlotInput {
  muscle_group: string;
  sets_display?: string;
}

export interface PickedWorkoutExercise {
  library_exercise_id: string;
  external_id: string | null;
  name: string;
  muscle_group: string;
  equipment: string | null;
  sets_display: string;
}

@Injectable()
export class PlanGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansAiService: PlansAiService,
    private readonly weightSuggestionService: WeightSuggestionService,
    private readonly analytics: AnalyticsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Builds a new 7-day training plan. With `force: false`, returns the
   * existing active plan if one exists. With `force: true`, deactivates the
   * current active plan first — gated behind a premium check because the
   * first generation after onboarding is free but re-rolls are paid.
   *
   * `focus` is an optional free-form user request (e.g. "bench press plan",
   * "powerlifting week"). When set, it's passed to PlansAiService so both
   * the skeleton (more compound slots for the named movement) and the
   * exercise-selection pass (prefer the named lift + variations) bias
   * toward what the user actually asked for.
   */
  async generatePlan(userId: string, force: boolean, focus?: string) {
    if (force) {
      const hasPlan = await this.subscriptionService.hasAnyPlan(userId);
      if (hasPlan) {
        const premium = await this.subscriptionService.isPremium(userId);
        if (!premium) {
          this.analytics.track(userId, 'paywall_feature_blocked', {
            feature: 'plan_generation',
          });
          throw new AppException(
            'PREMIUM_REQUIRED',
            'Plan re-generation requires a premium subscription',
            HttpStatus.FORBIDDEN,
          );
        }
      }
    }

    if (force) {
      await this.prisma.trainingPlan.updateMany({
        where: { user_id: userId, is_active: true },
        data: { is_active: false },
      });
    }

    const existing = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
    });
    if (existing && !force) {
      return { message: 'Plan already exists' };
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    if (!onboarding) {
      throw new AppException(
        'onboarding_required',
        'Please complete onboarding before generating a plan',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Priority chain: user's current request beats onboarding. When the
    // caller passes a `focus` (e.g. "bench press plan"), drop the equipment
    // filter so the AI sees the full library and can pick the named lift
    // even if it's outside the user's onboarded equipment. Without a focus
    // we keep onboarding as the default — a user who set bodyweight gets
    // a bodyweight plan when they didn't ask for anything else.
    const allowedEquipment = focus
      ? []
      : (EQUIPMENT_MAP[onboarding.available_equipment] ?? []);

    // Calculate start day of week (0=Mon..6=Sun)
    const now = new Date();
    const startDow = force ? 0 : toMondayDow(now);

    // Fetch skeleton, exercise library, recent exercises, and previous week number in parallel
    const [skeleton, exerciseLibrary, recentExerciseIds, previousPlan] =
      await Promise.all([
        this.plansAiService.generateWeeklyPlan(
          userId,
          onboarding,
          startDow,
          focus,
        ),
        this.prisma.exerciseLibrary.findMany({
          where: {
            OR: [{ is_system: true }, { user_id: userId }],
            ...(allowedEquipment.length > 0
              ? { equipment: { in: allowedEquipment } }
              : {}),
          },
          orderBy: { name: 'asc' },
        }),
        getRecentExerciseIds(this.prisma, userId),
        this.prisma.trainingPlan.findFirst({
          where: { user_id: userId },
          orderBy: { week_number: 'desc' },
        }),
      ]);
    const newWeekNumber = (previousPlan?.week_number ?? 0) + 1;

    // Stage 2: Build curated candidate pools per muscle group
    const candidatePools = filterCandidates(
      skeleton,
      exerciseLibrary,
      recentExerciseIds,
    );

    // Stage 3: AI picks specific exercises from candidates
    const recentExerciseNames = await getRecentExerciseNames(
      this.prisma,
      userId,
    );
    const aiSelection = await this.plansAiService.selectExercises(
      userId,
      skeleton,
      candidatePools,
      onboarding,
      recentExerciseNames,
      focus,
    );

    // Use AI selection if valid, otherwise fall back to deterministic matcher
    const generatedDays = aiSelection
      ? assembleFromAiSelection(skeleton, aiSelection, candidatePools)
      : matchSkeletonToDays(
          skeleton,
          exerciseLibrary,
          recentExerciseIds,
          onboarding.experience_level ?? null,
        );

    // Enrich exercises with suggested weights
    const allExercises = generatedDays.flatMap((day: any) =>
      (day.exercises ?? []).map((ex: any) => ({
        library_exercise_id: ex.library_exercise_id ?? null,
        muscle_group: ex.muscle_group ?? '',
        equipment: ex.equipment ?? '',
      })),
    );
    const weightMap = await this.weightSuggestionService.suggestWeights(
      userId,
      allExercises,
      onboarding,
    );
    for (const day of generatedDays) {
      if (day.exercises) {
        for (const ex of day.exercises as any[]) {
          if (ex.library_exercise_id) {
            ex.suggested_weight = weightMap.get(ex.library_exercise_id) ?? null;
          }
        }
      }
    }

    const weekStart = getWeekStart(now);

    const plan = await this.prisma.trainingPlan.create({
      data: {
        user_id: userId,
        week_number: newWeekNumber,
        week_start_date: weekStart,
        is_active: true,
        days: {
          create: generatedDays.map((day) => ({
            day_of_week: day.day_of_week,
            day_type: day.day_type,
            session_title: day.session_title ?? null,
            session_type: day.session_type ?? null,
            muscle_groups: day.muscle_groups ?? [],
            exercises_json: day.exercises ?? [],
            status: 'pending',
          })),
        },
      },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });

    this.analytics.track(userId, 'plan_generated', {
      plan_id: plan.id,
      week_number: newWeekNumber,
    });

    return { message: 'Plan generated', planId: plan.id };
  }

  /**
   * Single-workout cousin of generatePlan: takes a list of slots (muscle
   * groups + optional rep schemes proposed by the Coach), filters the
   * library per group, runs the same AI selection pass plan generation
   * uses, and returns the picked exercises ready to be persisted as a
   * WorkoutSession. Why mirror plan flow instead of letting Coach pick
   * exercises directly: pool-per-group gives the AI ~80 chest exercises
   * to choose from instead of all 700, and lets us force-include the
   * user's named lift in the pool so substitutions ("dumbbell bench
   * press" → "decline dumbbell bench press") become impossible at the
   * selection step.
   */
  async pickExercisesForWorkout(
    userId: string,
    slots: WorkoutSlotInput[],
    userFocus?: string,
  ): Promise<PickedWorkoutExercise[]> {
    if (slots.length === 0) return [];

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    // Equipment resolution — three tiers, highest wins:
    //   1. Equipment hint inside `focus` ("dumbbells for legs", "barbell
    //      bench press"). Narrow the pool to that specific equipment so
    //      the selector physically cannot pick a bodyweight exercise when
    //      the user asked for dumbbells.
    //   2. Other `focus` (named lift, no equipment hint). Drop the filter
    //      so the AI can find e.g. "Barbell Bench Press" even when the
    //      user is onboarded as bodyweight.
    //   3. No focus. Default to onboarding equipment.
    const equipmentHint = userFocus ? extractEquipmentHint(userFocus) : null;
    const allowedEquipment = equipmentHint
      ? [equipmentHint]
      : userFocus
        ? []
        : (EQUIPMENT_MAP[onboarding?.available_equipment ?? ''] ?? []);

    const [exerciseLibrary, recentExerciseIds, recentExerciseNames] =
      await Promise.all([
        this.prisma.exerciseLibrary.findMany({
          where: {
            OR: [{ is_system: true }, { user_id: userId }],
            ...(allowedEquipment.length > 0
              ? { equipment: { in: allowedEquipment } }
              : {}),
          },
          orderBy: { name: 'asc' },
        }),
        getRecentExerciseIds(this.prisma, userId),
        getRecentExerciseNames(this.prisma, userId),
      ]);

    // Wrap the slots in a single-day skeleton so we can reuse the plan
    // selection pipeline. filterCandidates() expects skeleton shape.
    const skeleton: SkeletonDay[] = [
      {
        day_of_week: 0,
        day_type: 'training',
        session_title: 'Workout',
        session_type: 'strength',
        exercise_slots: slots.map((s) => ({
          muscle_group: s.muscle_group,
          rep_scheme: s.sets_display ?? '3 × 10',
          focus: null,
        })),
      },
    ];

    const candidatePools = filterCandidates(
      skeleton,
      exerciseLibrary,
      recentExerciseIds,
    );

    // Force-include any library entry whose name the user named verbatim
    // (case-insensitive substring of their focus phrase, or vice versa).
    // Place it at the front of the appropriate muscle group's pool so it's
    // the obvious pick for the selector.
    if (userFocus) {
      forceIncludeFocusInPools(userFocus, exerciseLibrary, candidatePools);
    }

    const aiSelection = await this.plansAiService.selectExercises(
      userId,
      skeleton,
      candidatePools,
      onboarding,
      recentExerciseNames,
      userFocus,
    );

    // Take day 0's picks. assembleFromAiSelection fills in equipment +
    // external_id from the library, which we need for the workout session
    // exercise rows.
    const generatedDays = aiSelection
      ? assembleFromAiSelection(skeleton, aiSelection, candidatePools)
      : matchSkeletonToDays(
          skeleton,
          exerciseLibrary,
          recentExerciseIds,
          onboarding?.experience_level ?? null,
        );

    const day0 = generatedDays[0];
    if (!day0?.exercises) return [];

    return day0.exercises.map((ex: any, i: number) => ({
      library_exercise_id: ex.library_exercise_id ?? null,
      external_id: ex.external_id ?? null,
      name: ex.name,
      muscle_group: ex.muscle_group,
      equipment: ex.equipment ?? null,
      sets_display: slots[i]?.sets_display ?? ex.sets_display ?? '3 × 10',
    }));
  }
}

/**
 * If the user named a lift (e.g. "dumbbell bench press"), ensure any
 * library entry matching that name is at the front of its muscle group's
 * candidate pool — even if it would otherwise be filtered out for being
 * recently used. Substring matching is intentionally permissive: a focus
 * of "bench press" matches both "Bench Press" and "Dumbbell Bench Press";
 * a focus of "dumbbell bench press" matches "Dumbbell Bench Press" only.
 */
/**
 * Detect when the user's free-form focus phrase implies a specific
 * equipment type. Returns the library `equipment` value to narrow to,
 * or null when no equipment hint is present. Values match the
 * exercise_library.equipment column ("Barbell", "Dumbbells", "Bodyweight",
 * "Cable", "Machine", "Bands"). Plurals and common abbreviations are
 * folded in. Order matters: more specific tokens checked first so
 * "dumbbell bench press" matches Dumbbells (not Barbell from the word
 * "bench press").
 */
function extractEquipmentHint(focus: string): string | null {
  const lower = focus.toLowerCase();
  if (/\b(dumbbells?|dbs?)\b/.test(lower)) return 'Dumbbells';
  if (/\b(barbells?|bbs?)\b/.test(lower)) return 'Barbell';
  if (/\b(kettlebells?|kbs?)\b/.test(lower)) return 'Other';
  if (/\b(bodyweight|calisthenics?|bw)\b/.test(lower)) return 'Bodyweight';
  if (/\bcable[s]?\b/.test(lower)) return 'Cable';
  if (/\bmachines?\b/.test(lower)) return 'Machine';
  if (/\b(bands?|resistance bands?)\b/.test(lower)) return 'Bands';
  return null;
}

function forceIncludeFocusInPools(
  focus: string,
  library: any[],
  pools: Map<string, any[]>,
): void {
  const lowerFocus = focus.toLowerCase();
  for (const ex of library) {
    const lowerName = (ex.name as string).toLowerCase();
    if (!lowerFocus.includes(lowerName) && !lowerName.includes(lowerFocus)) {
      continue;
    }
    const group = ex.muscle_group as string;
    if (!group) continue;
    const pool = pools.get(group) ?? [];
    if (!pool.some((p) => p.id === ex.id)) {
      pool.unshift(ex);
      pools.set(group, pool);
    } else {
      // Already in pool — move to front so the selector sees it first.
      const idx = pool.findIndex((p) => p.id === ex.id);
      if (idx > 0) {
        const [item] = pool.splice(idx, 1);
        pool.unshift(item);
      }
    }
  }
}
