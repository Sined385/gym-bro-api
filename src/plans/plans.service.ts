import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PlansAiService } from './plans-ai.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { WeightSuggestionService } from '../home/weight-suggestion.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  matchSkeletonToDays,
  matchExercisesToSlots,
  normalizeMuscleGroup,
  filterCandidates,
  assembleFromAiSelection,
  ExerciseSlot,
} from './exercise-matcher';
import { exerciseImageUrl } from '../common/exercise-image';
import { getWeekStart, toMondayDow } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { formatSessionResponse } from '../common/format-session';
import { computeRecentLifts } from '../common/recent-lifts';
import { WorkoutOrchestratorService } from '../workouts/workout-orchestrator.service';
import { formatPlanDay } from './format-plan';


@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansAiService: PlansAiService,
    private readonly weightSuggestionService: WeightSuggestionService,
    private readonly analytics: AnalyticsService,
    private readonly subscriptionService: SubscriptionService,
    // forwardRef: PlansService is injected back into the orchestrator,
    // so we use forwardRef to resolve the constructor-time cycle.
    @Inject(forwardRef(() => WorkoutOrchestratorService))
    private readonly orchestrator: WorkoutOrchestratorService,
  ) {}

  async getActivePlan(userId: string) {
    let plan = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      include: {
        days: {
          orderBy: { day_of_week: 'asc' },
          include: {
            workout_session: {
              select: {
                id: true,
                duration_minutes: true,
                completed_at: true,
              },
            },
          },
        },
      },
    });

    if (!plan) {
      // Generate in background — client should poll
      this.generatePlan(userId, false).catch(() => {});
      return {
        status: 'generating' as const,
        plan: null,
        days: [],
        todayIndex: 0,
      };
    }

    // Auto-advance week if needed
    const now = new Date();
    const weekEnd = new Date(
      plan.week_start_date.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    if (now >= weekEnd) {
      // Generate new week and return it instead of stale plan
      await this.generatePlan(userId, true);
      plan = await this.prisma.trainingPlan.findFirst({
        where: { user_id: userId, is_active: true },
        include: {
          days: {
            orderBy: { day_of_week: 'asc' },
            include: {
              workout_session: {
                select: {
                  id: true,
                  duration_minutes: true,
                  completed_at: true,
                },
              },
            },
          },
        },
      });
      if (!plan) {
        return {
          status: 'generating' as const,
          plan: null,
          days: [],
          todayIndex: 0,
        };
      }
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    // Calculate today's index as position within the returned days array
    const absoluteTodayDow = toMondayDow(now);

    // Adapt skipped days — mark past pending training days as skipped and redistribute
    const adapted = await this.adaptSkippedDays(
      plan,
      absoluteTodayDow,
      userId,
      onboarding,
    );
    if (adapted) {
      // Re-fetch to reflect adaptations
      plan = (await this.prisma.trainingPlan.findFirst({
        where: { user_id: userId, is_active: true },
        include: {
          days: {
            orderBy: { day_of_week: 'asc' },
            include: {
              workout_session: {
                select: {
                  id: true,
                  duration_minutes: true,
                  completed_at: true,
                },
              },
            },
          },
        },
      }))!;
    }

    let todayIndex = plan.days.findIndex(
      (d) => d.day_of_week === absoluteTodayDow,
    );
    if (todayIndex === -1) {
      todayIndex = plan.days.length - 1;
    }

    return {
      plan: {
        id: plan.id,
        weekNumber: plan.week_number,
        primaryGoals: onboarding?.primary_goals ?? ['build_muscle'],
        experienceLevel: onboarding?.experience_level ?? 'intermediate',
      },
      days: plan.days.map((day) => formatPlanDay(day)),
      todayIndex,
    };
  }

  async generatePlan(userId: string, force: boolean, focus?: string) {
    // Premium check: first plan after onboarding is free; re-generation requires premium
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

    const allowedEquipment =
      EQUIPMENT_MAP[onboarding.available_equipment] ?? [];

    // Calculate start day of week (0=Mon..6=Sun).
    //   - force regen → generate the FULL Mon-Sun week so past days
    //     are present in the plan (UI shows them as "skipped,
    //     redistributed" rather than missing entirely); the
    //     redistributeDeficit call below moves their muscle groups
    //     forward.
    //   - first-time generation → start from today; the user has no
    //     past plan history to redistribute from, so generating past
    //     days would just create phantom skips.
    const now = new Date();
    const todayDow = toMondayDow(now);
    const startDow = force ? 0 : todayDow;

    // Fetch skeleton, exercise library, recent exercises, recent sessions
    // (for progressive-overload context), and previous week number in
    // parallel.
    const [
      skeleton,
      exerciseLibrary,
      recentExerciseIds,
      recentSessions,
      previousPlan,
    ] = await Promise.all([
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
      this.getRecentExerciseIds(userId),
      this.prisma.workoutSession.findMany({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { completed_at: 'desc' },
        include: {
          exercises: {
            orderBy: { step_number: 'asc' },
            include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
          },
        },
      }),
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

    // Stage 3: AI picks specific exercises from candidates, supplying
    // target_sets for any pool entry that appears in the user's
    // recent-lifts data (progressive overload path).
    const recentExerciseNames = await this.getRecentExerciseNames(userId);
    const recentLifts = computeRecentLifts(recentSessions);
    const aiSelection = await this.plansAiService.selectExercises(
      userId,
      skeleton,
      candidatePools,
      onboarding,
      recentExerciseNames,
      recentLifts,
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
            // Cast to any — Prisma's Json column expects InputJsonValue
            // which doesn't match strict object types with optional
            // fields like `target_sets`. The shape is still valid JSON.
            exercises_json: (day.exercises ?? []) as any,
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

    // Mid-week regen: past days were just persisted as `pending`. Run
    // reconcile + redistribute right now so they get marked `skipped`
    // and their muscle groups flow into today + future. Without this,
    // the user opens the app immediately after regen and sees Monday
    // as a phantom "do this workout" card.
    if (force && todayDow > 0) {
      await this.orchestrator.reconcileWithAdHocSessions(userId);
      const refreshed = await this.prisma.trainingPlan.findUnique({
        where: { id: plan.id },
        include: { days: { orderBy: { day_of_week: 'asc' } } },
      });
      if (refreshed) {
        await this.redistributeDeficit(
          refreshed,
          todayDow,
          userId,
          onboarding,
        );
      }
    }

    return { message: 'Plan generated', planId: plan.id };
  }

  async startPlanSession(userId: string, dayId: string) {
    const planDay = await this.prisma.planDay.findUnique({
      where: { id: dayId },
      include: { plan: true },
    });

    if (!planDay || planDay.plan.user_id !== userId) {
      throw new AppException(
        'plan_day_not_found',
        'Plan day not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (planDay.day_type !== 'training') {
      throw new AppException(
        'invalid_day_type',
        'Cannot start a session on a rest day',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (planDay.status === 'completed') {
      throw new AppException(
        'day_already_completed',
        'This day has already been completed',
        HttpStatus.CONFLICT,
      );
    }

    if (planDay.status === 'skipped') {
      throw new AppException(
        'day_skipped',
        'This day was skipped and its exercises were redistributed',
        HttpStatus.CONFLICT,
      );
    }

    if (planDay.workout_session_id) {
      // Session already exists, return it
      const existing = await this.prisma.workoutSession.findUnique({
        where: { id: planDay.workout_session_id },
        include: { exercises: { orderBy: { step_number: 'asc' } } },
      });
      if (existing && existing.status === 'active') {
        return formatSessionResponse(existing);
      }
    }

    const exercises = planDay.exercises_json as any[];

    // Validate library_exercise_ids still exist (seed script regenerates UUIDs on deploy)
    const libraryIds = exercises
      .map((ex: any) => ex.library_exercise_id)
      .filter((id: string | null): id is string => !!id);
    const validLibExercises = new Map<
      string,
      { id: string; external_id: string | null }
    >();
    if (libraryIds.length > 0) {
      const existing = await this.prisma.exerciseLibrary.findMany({
        where: { id: { in: libraryIds } },
        select: { id: true, external_id: true },
      });
      for (const e of existing)
        validLibExercises.set(e.id, {
          id: e.id,
          external_id: e.external_id,
        });
    }

    // Re-resolve stale IDs by exercise name from current library
    const nameToLibExercise = new Map<
      string,
      { id: string; external_id: string | null }
    >();
    const staleNames = exercises
      .filter(
        (ex: any) =>
          ex.library_exercise_id &&
          !validLibExercises.has(ex.library_exercise_id),
      )
      .map((ex: any) => ex.name as string);
    if (staleNames.length > 0) {
      const resolved = await this.prisma.exerciseLibrary.findMany({
        where: { name: { in: staleNames }, is_system: true },
        select: { id: true, name: true, external_id: true },
      });
      for (const e of resolved)
        nameToLibExercise.set(e.name, {
          id: e.id,
          external_id: e.external_id,
        });
    }

    // Create WorkoutSession + SessionExercise rows
    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: planDay.session_title ?? 'Training Session',
        type: planDay.session_type ?? 'strength',
        status: 'active',
        started_at: new Date(),
        ai_generated: true,
        ai_message: `Part of your Week ${planDay.plan.week_number} training plan`,
        updated_at: new Date(),
        exercises: {
          create: exercises.map((ex: any, i: number) => {
            let libId: string | null = null;
            let externalId: string | null = ex.external_id ?? null;
            if (
              ex.library_exercise_id &&
              validLibExercises.has(ex.library_exercise_id)
            ) {
              const libEx = validLibExercises.get(ex.library_exercise_id)!;
              libId = libEx.id;
              externalId = libEx.external_id ?? externalId;
            } else if (ex.name && nameToLibExercise.has(ex.name)) {
              const libEx = nameToLibExercise.get(ex.name)!;
              libId = libEx.id;
              externalId = libEx.external_id ?? externalId;
            }
            // Materialize per-set targets persisted at plan time as
            // pre-filled exercise_sets rows. Same trick the Coach
            // single-workout path uses — gives the active session view
            // a real ladder to render instead of falling back to the
            // generic sets_display placeholders.
            const targets = Array.isArray(ex.target_sets) ? ex.target_sets : [];
            const exerciseSets =
              targets.length > 0
                ? {
                    create: targets.map((s: any, sIdx: number) => ({
                      set_number: sIdx + 1,
                      weight:
                        s.is_bodyweight || s.weight_kg === undefined
                          ? null
                          : s.weight_kg,
                      weight_unit: 'kg',
                      reps: s.reps,
                      is_bodyweight: s.is_bodyweight ?? false,
                      is_completed: false,
                    })),
                  }
                : undefined;
            return {
              library_exercise_id: libId,
              external_id: externalId,
              name: ex.name,
              muscle_group: ex.muscle_group,
              equipment: ex.equipment ?? null,
              step_number: i + 1,
              sets_display: ex.sets_display || '3 × 10',
              accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
              suggested_weight: ex.suggested_weight ?? null,
              ...(exerciseSets ? { exercise_sets: exerciseSets } : {}),
            };
          }),
        },
      },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });

    // Link PlanDay to session
    await this.prisma.planDay.update({
      where: { id: dayId },
      data: { workout_session_id: session.id },
    });

    this.analytics.track(userId, 'plan_day_started', {
      plan_day_id: dayId,
      session_id: session.id,
    });

    return formatSessionResponse(session);
  }

  async onSessionCompleted(sessionId: string) {
    const planDay = await this.prisma.planDay.findFirst({
      where: { workout_session_id: sessionId },
      include: { plan: true },
    });

    if (!planDay) return; // Not a plan session

    const session = await this.prisma.workoutSession.findUnique({
      where: { id: sessionId },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
        },
      },
    });

    let aiNotes = 'Session completed successfully.';
    if (session) {
      try {
        aiNotes = await this.plansAiService.generateCompletionNotes(
          session.user_id,
          planDay,
          session,
        );
      } catch {
        // fallback already set
      }
    }

    await this.prisma.planDay.update({
      where: { id: planDay.id },
      data: {
        status: 'completed',
        ai_notes: aiNotes,
      },
    });
  }

  private async getRecentExerciseIds(userId: string): Promise<Set<string>> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const recentExercises = await this.prisma.sessionExercise.findMany({
      where: {
        library_exercise_id: { not: null },
        session: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: twoWeeksAgo },
        },
      },
      select: { library_exercise_id: true },
    });

    return new Set(
      recentExercises
        .map((e) => e.library_exercise_id)
        .filter((id): id is string => id !== null),
    );
  }

  private async getRecentExerciseNames(userId: string): Promise<string[]> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const recent = await this.prisma.sessionExercise.findMany({
      where: {
        session: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: twoWeeksAgo },
        },
      },
      select: { name: true },
      distinct: ['name'],
      take: 20,
    });

    return recent.map((e) => e.name);
  }

  /**
   * Detects past pending training days, marks them as skipped, and
   * redistributes missed muscle groups into remaining future days.
   * Returns true if any changes were made.
   */
  private async adaptSkippedDays(
    plan: any,
    todayDow: number,
    userId: string,
    onboarding: any | null,
  ): Promise<boolean> {
    // Lazy fallback: defer recovery to the orchestrator (eager path
    // runs from recordCompletion; this catches anything missed). The
    // method is idempotent — uses adapted_at to avoid double work.
    const { recoveredDayIds } =
      await this.orchestrator.reconcileWithAdHocSessions(userId);

    // Refetch since the reconcile may have flipped some plan days to
    // completed.
    const refreshed = await this.prisma.trainingPlan.findUnique({
      where: { id: plan.id },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });
    if (!refreshed) return recoveredDayIds.length > 0;
    plan = refreshed;

    const redistributed = await this.redistributeDeficit(
      plan,
      todayDow,
      userId,
      onboarding,
    );
    return redistributed || recoveredDayIds.length > 0;
  }

  /**
   * Distribute muscle-group deficit from skipped past training days
   * across remaining pending training days this week (and, if needed,
   * convert the earliest future rest day to training). Public so the
   * orchestrator can call it eagerly from recordCompletion in
   * addition to the lazy adaptSkippedDays path.
   *
   * "Skipped" here means: past pending training days with no
   * adapted_at — recovery from ad-hoc completed sessions has already
   * run upstream, so anything left in this set is truly missed.
   */
  async redistributeDeficit(
    plan: any,
    todayDow: number,
    userId: string,
    onboarding: any | null,
  ): Promise<boolean> {
    // 1. Find skipped days — pending training days before today with no prior adaptation
    const skippedDays = plan.days.filter(
      (d: any) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week < todayDow &&
        !d.adapted_at,
    );

    // Fast path — nothing to redistribute
    if (skippedDays.length === 0) return false;

    // 3. Find future pending training days (after today)
    const futureDays = plan.days.filter(
      (d: any) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week > todayDow,
    );

    // Include today if it's a pending training day
    const todayDay = plan.days.find(
      (d: any) =>
        d.day_of_week === todayDow &&
        d.status === 'pending' &&
        d.day_type === 'training',
    );

    // 4. Collect missed muscle groups from skipped days
    const missedGroups: string[] = [];
    for (const day of skippedDays) {
      missedGroups.push(...(day.muscle_groups ?? []));
    }

    // 5. Collect already-planned muscle groups (today + future)
    const plannedGroups: string[] = [];
    if (todayDay) plannedGroups.push(...(todayDay.muscle_groups ?? []));
    for (const day of futureDays) {
      plannedGroups.push(...(day.muscle_groups ?? []));
    }

    // 6. Compute deficit
    const deficit = this.computeMuscleGroupDeficit(missedGroups, plannedGroups);

    const now = new Date();
    const skippedIds = skippedDays.map((d: any) => d.id);

    // 7. Pending pending today as a rest day — eligible candidate for
    // conversion to training when there's deficit. The user opened the
    // app today and didn't train yesterday; converting today honours
    // their intent (they're here, they can lift) rather than pushing
    // the missed work to Wed/Fri.
    const todayRestDay = plan.days.find(
      (d: any) =>
        d.day_of_week === todayDow &&
        d.day_type === 'rest' &&
        d.status === 'pending',
    );

    // 8. No deficit OR no destination — just mark skipped, no redistribution needed
    const hasAnyDestination =
      futureDays.length > 0 || todayRestDay !== undefined;
    if (deficit.length === 0 || !hasAnyDestination) {
      await this.prisma.planDay.updateMany({
        where: { id: { in: skippedIds } },
        data: { status: 'skipped', adapted_at: now },
      });
      this.analytics.track(userId, 'plan_adapted', {
        plan_id: plan.id,
        skipped_days: skippedDays.map((d: any) => d.day_of_week),
        adapted_days: [],
      });
      return true;
    }

    // 9. Distribute deficit
    const allowedEquipment =
      EQUIPMENT_MAP[onboarding?.available_equipment ?? ''] ?? [];

    const [exerciseLibrary, recentExerciseIds] = await Promise.all([
      this.prisma.exerciseLibrary.findMany({
        where: {
          OR: [{ is_system: true }, { user_id: userId }],
          ...(allowedEquipment.length > 0
            ? { equipment: { in: allowedEquipment } }
            : {}),
        },
        orderBy: { name: 'asc' },
      }),
      this.getRecentExerciseIds(userId),
    ]);

    const repScheme = this.getRepScheme(onboarding?.primary_goals ?? []);
    const userLevel = onboarding?.experience_level ?? null;

    const adaptedDayIds: string[] = [];
    let remainingDeficit = [...deficit];

    // Persist everything in a single transaction
    await this.prisma.$transaction(async (tx) => {
      // 9a. Priority: convert today's rest day to training if it's
      // pending. Pulls up to 3 muscle groups (a full make-up session)
      // before pushing the rest forward.
      if (todayRestDay && remainingDeficit.length > 0) {
        const toAdd = remainingDeficit.splice(0, 3);
        const slots: ExerciseSlot[] = toAdd.map((group) => ({
          muscle_group: group,
          rep_scheme: repScheme,
          focus: null,
        }));
        const picks = matchExercisesToSlots(
          slots,
          exerciseLibrary,
          recentExerciseIds,
          userLevel,
        );
        const newExercises = picks.map((pick, i) => ({
          library_exercise_id: pick.id,
          external_id: pick.external_id,
          name: pick.name,
          muscle_group: pick.muscle_group,
          equipment: pick.equipment,
          sets_display: slots[i].rep_scheme,
        }));
        const muscleGroups = [
          ...new Set(newExercises.map((e) => e.muscle_group)),
        ];
        const title = muscleGroups.join(' & ') + ' Day';
        await tx.planDay.update({
          where: { id: todayRestDay.id },
          data: {
            day_type: 'training',
            session_title: title,
            session_type: 'strength',
            muscle_groups: muscleGroups,
            exercises_json: newExercises,
            adapted_at: now,
          },
        });
        adaptedDayIds.push(todayRestDay.id);
      }

      // 9b. Distribute remaining deficit to existing future training days (max +2 groups per day)
      for (const day of futureDays) {
        if (remainingDeficit.length === 0) break;

        const toAdd = remainingDeficit.splice(0, 2);

        const slots: ExerciseSlot[] = toAdd.map((group) => ({
          muscle_group: group,
          rep_scheme: repScheme,
          focus: null,
        }));

        const picks = matchExercisesToSlots(
          slots,
          exerciseLibrary,
          recentExerciseIds,
          userLevel,
        );

        const newExercises = picks.map((pick, i) => ({
          library_exercise_id: pick.id,
          external_id: pick.external_id,
          name: pick.name,
          muscle_group: pick.muscle_group,
          equipment: pick.equipment,
          sets_display: slots[i].rep_scheme,
        }));

        const existingExercises = day.exercises_json as any[];
        const updatedExercises = [...existingExercises, ...newExercises];

        const existingGroups = day.muscle_groups as string[];
        const addedGroups = [
          ...new Set(newExercises.map((e) => e.muscle_group)),
        ];
        const mergedGroups = [...new Set([...existingGroups, ...addedGroups])];

        const updatedTitle = mergedGroups.join(' & ') + ' Day';

        await tx.planDay.update({
          where: { id: day.id },
          data: {
            exercises_json: updatedExercises,
            muscle_groups: mergedGroups,
            session_title: updatedTitle,
            adapted_at: now,
          },
        });

        adaptedDayIds.push(day.id);
      }

      // 9. If deficit remains — convert earliest future rest day to training
      if (remainingDeficit.length > 0) {
        const futureRestDays = plan.days.filter(
          (d: any) =>
            d.day_type === 'rest' &&
            d.day_of_week > todayDow &&
            d.status === 'pending',
        );

        if (futureRestDays.length > 0) {
          const restDay = futureRestDays[0];
          const slots: ExerciseSlot[] = remainingDeficit.map((group) => ({
            muscle_group: group,
            rep_scheme: repScheme,
            focus: null,
          }));

          const picks = matchExercisesToSlots(
            slots,
            exerciseLibrary,
            recentExerciseIds,
            userLevel,
          );

          const exercises = picks.map((pick, i) => ({
            library_exercise_id: pick.id,
            external_id: pick.external_id,
            name: pick.name,
            muscle_group: pick.muscle_group,
            equipment: pick.equipment,
            sets_display: slots[i].rep_scheme,
          }));

          const muscleGroups = [
            ...new Set(exercises.map((e) => e.muscle_group)),
          ];
          const title = muscleGroups.join(' & ') + ' Day';

          await tx.planDay.update({
            where: { id: restDay.id },
            data: {
              day_type: 'training',
              session_title: title,
              session_type: 'strength',
              muscle_groups: muscleGroups,
              exercises_json: exercises,
              adapted_at: now,
            },
          });

          adaptedDayIds.push(restDay.id);
          remainingDeficit = [];
        }
      }

      // Mark skipped days
      await tx.planDay.updateMany({
        where: { id: { in: skippedIds } },
        data: { status: 'skipped', adapted_at: now },
      });
    });

    // 10. Track analytics
    this.analytics.track(userId, 'plan_adapted', {
      plan_id: plan.id,
      skipped_days: skippedDays.map((d: any) => d.day_of_week),
      adapted_days: adaptedDayIds,
      deficit_groups: deficit,
    });

    return true;
  }

  private computeMuscleGroupDeficit(
    missed: string[],
    planned: string[],
  ): string[] {
    const missedCounts = new Map<string, number>();
    for (const g of missed) {
      const norm = normalizeMuscleGroup(g);
      missedCounts.set(norm, (missedCounts.get(norm) ?? 0) + 1);
    }

    const plannedCounts = new Map<string, number>();
    for (const g of planned) {
      const norm = normalizeMuscleGroup(g);
      plannedCounts.set(norm, (plannedCounts.get(norm) ?? 0) + 1);
    }

    const deficit: string[] = [];
    for (const [group, count] of missedCounts) {
      const diff = count - (plannedCounts.get(group) ?? 0);
      for (let i = 0; i < diff; i++) {
        deficit.push(group);
      }
    }

    return deficit;
  }

  private getRepScheme(goals: string[]): string {
    if (goals.includes('get_stronger')) return '4 \u00D7 6';
    if (goals.includes('lose_fat')) return '3 \u00D7 12';
    return '3 \u00D7 10';
  }
}
