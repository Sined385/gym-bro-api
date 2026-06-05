import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PlansAiService } from './plans-ai.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { WeightSuggestionService } from '../home/weight-suggestion.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  matchSkeletonToDays,
  filterCandidates,
  assembleFromAiSelection,
} from './exercise-matcher';
import {
  getWeekStartInTz,
  toMondayDowInTz,
} from '../common/date-utils';
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

    const [onboarding, userRow] = await Promise.all([
      this.prisma.onboardingData.findUnique({
        where: { user_id: userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      }),
    ]);
    const tz = userRow?.timezone ?? null;

    // Calculate today's index as position within the returned days array
    const absoluteTodayDow = toMondayDowInTz(now, tz);

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
      // Find the active plan's day ids so we can release the
      // workout_session_id @unique link on each — without this, when
      // reconcileWithAdHocSessions runs on the brand-new plan it can't
      // claim any session that the abandoned plan day still claims,
      // leaving the new plan's Mon/Wed/etc. pending even though the
      // user already trained those days.
      const activePlans = await this.prisma.trainingPlan.findMany({
        where: { user_id: userId, is_active: true },
        select: { id: true },
      });
      const activePlanIds = activePlans.map((p) => p.id);
      if (activePlanIds.length > 0) {
        await this.prisma.planDay.updateMany({
          where: {
            plan_id: { in: activePlanIds },
            workout_session_id: { not: null },
          },
          data: { workout_session_id: null },
        });
      }
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
    const planUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const planTz = planUser?.timezone ?? null;
    const todayDow = toMondayDowInTz(now, planTz);
    const startDow = force ? 0 : todayDow;

    // Phase A: fetch everything the AI needs in parallel BEFORE the
    // skeleton call. The week-of-completed-sessions query feeds a new
    // `weekContext` parameter on generateWeeklyPlan so the AI structures
    // already-trained days as completed training days instead of
    // proposing a duplicate workout for a day the user already finished.
    const weekStartDate = getWeekStartInTz(now, planTz);
    const tomorrowStart = new Date(now);
    tomorrowStart.setHours(0, 0, 0, 0);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const [
      exerciseLibrary,
      recentExerciseIds,
      thisWeekSessions,
      recentSessions,
      previousPlan,
    ] = await Promise.all([
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
          completed_at: { gte: weekStartDate, lt: tomorrowStart },
        },
        orderBy: { completed_at: 'asc' },
        include: {
          exercises: {
            orderBy: { step_number: 'asc' },
            include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
          },
        },
      }),
      this.prisma.workoutSession.findMany({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          },
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

    // Build the weekContext from this-week sessions. Group by
    // day_of_week (multiple sessions same day collapse into one
    // completedDay entry — usually only happens for power-users; the
    // AI just needs to know that day was hit). One pass.
    const completedDaysMap = new Map<
      number,
      { dayOfWeek: number; title: string; muscleGroups: string[]; topLifts: string[] }
    >();
    for (const session of thisWeekSessions) {
      if (!session.completed_at) continue;
      const dow = toMondayDowInTz(session.completed_at, planTz);
      const existing = completedDaysMap.get(dow);
      const muscleGroups: string[] = [];
      const topLifts: string[] = [];
      for (const ex of session.exercises) {
        if (ex.muscle_group && !muscleGroups.includes(ex.muscle_group)) {
          muscleGroups.push(ex.muscle_group);
        }
        if (topLifts.length < 3) {
          const topSet = ex.exercise_sets.reduce<
            (typeof ex.exercise_sets)[number] | null
          >((best, s) => {
            const weight = Number(s.weight ?? 0);
            return !best || weight > Number(best.weight ?? 0) ? s : best;
          }, null);
          if (topSet) {
            const w = topSet.is_bodyweight
              ? 'BW'
              : `${Number(topSet.weight ?? 0)} ${topSet.weight_unit}`;
            topLifts.push(`${ex.name} ${w} × ${topSet.reps}`);
          }
        }
      }
      if (existing) {
        for (const g of muscleGroups) {
          if (!existing.muscleGroups.includes(g)) existing.muscleGroups.push(g);
        }
        for (const l of topLifts) {
          if (existing.topLifts.length < 3) existing.topLifts.push(l);
        }
      } else {
        completedDaysMap.set(dow, {
          dayOfWeek: dow,
          title: session.title,
          muscleGroups,
          topLifts,
        });
      }
    }
    const weekContext = {
      completedDays: [...completedDaysMap.values()].sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek,
      ),
    };

    // Now generate the skeleton with the week context.
    const skeleton = await this.plansAiService.generateWeeklyPlan(
      userId,
      onboarding,
      startDow,
      focus,
      weekContext,
    );

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

    // Enrich exercises with suggested weights — include alt-session
    // exercises so promoted rest days carry pre-computed weights too.
    const allExercises = generatedDays.flatMap((day: any) => [
      ...(day.exercises ?? []).map((ex: any) => ({
        library_exercise_id: ex.library_exercise_id ?? null,
        muscle_group: ex.muscle_group ?? '',
        equipment: ex.equipment ?? '',
      })),
      ...((day.alt_session?.exercises ?? []) as any[]).map((ex: any) => ({
        library_exercise_id: ex.library_exercise_id ?? null,
        muscle_group: ex.muscle_group ?? '',
        equipment: ex.equipment ?? '',
      })),
    ]);
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
      if (day.alt_session?.exercises) {
        for (const ex of day.alt_session.exercises as any[]) {
          if (ex.library_exercise_id) {
            ex.suggested_weight = weightMap.get(ex.library_exercise_id) ?? null;
          }
        }
      }
    }

    const weekStart = getWeekStartInTz(now, planTz);

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
            alt_session_json: day.alt_session ? (day.alt_session as any) : null,
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

    // Always run reconcile after creating a plan: even an empty-week
    // generation can have an early-morning ad-hoc session that should
    // adopt today's plan day instead of orphaning. reconcile is
    // idempotent (no-op when no candidates exist), so the cost is one
    // cheap query for the new-user case.
    await this.orchestrator.reconcileWithAdHocSessions(userId);

    // Safety net: the AI prompt directs already-trained days to be
    // training entries with the matching muscle groups, but if it
    // ignored the weekContext hint and labeled a trained day as rest,
    // promote that rest day to a completed training day backed by the
    // user's actual session.
    await this.promoteRestDaysToCompletedSessions(plan.id, userId, todayDow);

    // Mid-week regen: past pending training days redistribute their
    // muscle groups forward via alt-session promotion.
    if (force && todayDow > 0) {
      const refreshed = await this.prisma.trainingPlan.findUnique({
        where: { id: plan.id },
        include: { days: { orderBy: { day_of_week: 'asc' } } },
      });
      if (refreshed) {
        await this.redistributeDeficit(refreshed, todayDow, userId, onboarding);
      }
    }

    return { message: 'Plan generated', planId: plan.id };
  }

  async startPlanSession(userId: string, dayId: string) {
    // Read-only since the "store on complete" refactor: returns the
    // plan day's exercise template + a client-side session UUID without
    // creating any WorkoutSession / SessionExercise rows or touching
    // PlanDay. The session only materializes server-side when iOS
    // posts /complete-full with the same UUID, at which point the
    // server creates the row, attaches the user's logged sets, and
    // links workout_session_id back to this plan day.
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
      const lookup = await this.prisma.exerciseLibrary.findMany({
        where: { id: { in: libraryIds } },
        select: { id: true, external_id: true },
      });
      for (const e of lookup)
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

    const now = new Date();
    const sessionId = randomUUID();
    const formattedExercises = exercises.map((ex: any, i: number) => {
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
      const targets = Array.isArray(ex.target_sets) ? ex.target_sets : [];
      return {
        id: randomUUID(),
        library_exercise_id: libId,
        external_id: externalId,
        name: ex.name,
        muscle_group: ex.muscle_group,
        equipment: ex.equipment ?? null,
        step_number: i + 1,
        sets_display: ex.sets_display || '3 × 10',
        accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
        suggested_weight: ex.suggested_weight ?? null,
        target_sets: targets.length > 0 ? targets : undefined,
      };
    });

    this.analytics.track(userId, 'plan_day_started', {
      plan_day_id: dayId,
      session_id: sessionId,
    });

    return formatSessionResponse({
      id: sessionId,
      user_id: userId,
      title: planDay.session_title ?? 'Training Session',
      type: planDay.session_type ?? 'strength',
      status: 'active',
      started_at: now,
      completed_at: null,
      duration_minutes: null,
      ai_generated: true,
      ai_message: `Part of your Week ${planDay.plan.week_number} training plan`,
      created_at: now,
      updated_at: now,
      exercises: formattedExercises as any,
    } as any);
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
   * Promote AI-planned alt sessions in place of skipped training days.
   *
   * Every rest day carries an alt_session_json planned by the AI at
   * week-start. When an earlier training day is missed, we promote the
   * next pending rest day that has an alt — no AI call at adapt time.
   * Today's rest day is preferred so the user can still train today.
   * Returns true if anything changed. Surfaces unabsorbed skips via
   * the `plan_adapted` analytics event; the dashboard reads the live
   * day rows to decide whether to show `plan_needs_regen`.
   */
  async redistributeDeficit(
    plan: any,
    todayDow: number,
    userId: string,
    _onboarding: any | null,
  ): Promise<boolean> {
    void _onboarding; // legacy signature; alts make onboarding unnecessary at adapt time

    const skippedDays = plan.days.filter(
      (d: any) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week < todayDow &&
        !d.adapted_at,
    );

    if (skippedDays.length === 0) return false;

    // Eligible alt destinations: pending rest days with a non-null
    // alt_session_json that haven't already been promoted. Prefer
    // today first (user is here, can still train today), then
    // chronological future rest days.
    const altCandidates = plan.days
      .filter(
        (d: any) =>
          d.day_type === 'rest' &&
          d.status === 'pending' &&
          d.day_of_week >= todayDow &&
          !d.adapted_at &&
          d.alt_session_json,
      )
      .sort((a: any, b: any) => {
        if (a.day_of_week === todayDow && b.day_of_week !== todayDow) return -1;
        if (b.day_of_week === todayDow && a.day_of_week !== todayDow) return 1;
        return a.day_of_week - b.day_of_week;
      });

    const now = new Date();
    const promotedRestDays: number[] = [];
    const absorbedSkippedDays: number[] = [];
    const unabsorbedSkippedDays: number[] = [];

    await this.prisma.$transaction(async (tx) => {
      let altIdx = 0;
      for (const skipped of skippedDays) {
        const restDay = altCandidates[altIdx];
        if (restDay) {
          const alt = restDay.alt_session_json as {
            session_title?: string;
            session_type?: string;
            muscle_groups?: string[];
            exercises?: any[];
          };
          await tx.planDay.update({
            where: { id: restDay.id },
            data: {
              day_type: 'training',
              session_title: alt.session_title ?? 'Make-up Session',
              session_type: alt.session_type ?? 'strength',
              muscle_groups: alt.muscle_groups ?? [],
              exercises_json: (alt.exercises ?? []) as any,
              adapted_at: now,
            },
          });
          promotedRestDays.push(restDay.day_of_week);
          absorbedSkippedDays.push(skipped.day_of_week);
          altIdx++;
        } else {
          unabsorbedSkippedDays.push(skipped.day_of_week);
        }
      }

      await tx.planDay.updateMany({
        where: { id: { in: skippedDays.map((d: any) => d.id) } },
        data: { status: 'skipped', adapted_at: now },
      });
    });

    this.analytics.track(userId, 'plan_adapted', {
      plan_id: plan.id,
      skipped_days: skippedDays.map((d: any) => d.day_of_week),
      promoted_alt_days: promotedRestDays,
      absorbed_days: absorbedSkippedDays,
      unabsorbed_days: unabsorbedSkippedDays,
    });

    return true;
  }

  /**
   * Safety net for the unified plan + history flow. The plan-gen prompt
   * directs already-trained days to be marked TRAINING with the matching
   * muscle groups; this catches the case where the AI ignored that hint
   * and labeled a trained day as REST.
   *
   * For each pending rest day on or before today, if the user has a
   * completed workout that calendar day that isn't already linked to
   * any plan day, convert the rest day into a completed training day
   * backed by that session — same shape `reconcileWithAdHocSessions`
   * uses for already-training days.
   */
  private async promoteRestDaysToCompletedSessions(
    planId: string,
    userId: string,
    todayDow: number,
  ): Promise<void> {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });
    if (!plan) return;

    const candidates = plan.days.filter(
      (d) =>
        d.status === 'pending' &&
        d.day_type === 'rest' &&
        d.day_of_week <= todayDow,
    );
    if (candidates.length === 0) return;

    const weekStart = new Date(plan.week_start_date);
    weekStart.setHours(0, 0, 0, 0);
    const now = new Date();

    for (const day of candidates) {
      const dayStart = new Date(weekStart);
      dayStart.setDate(dayStart.getDate() + day.day_of_week);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const session = await this.prisma.workoutSession.findFirst({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: dayStart, lt: dayEnd },
          plan_day: null,
        },
        orderBy: { completed_at: 'asc' },
        include: {
          exercises: {
            orderBy: { step_number: 'asc' },
            include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
          },
        },
      });
      if (!session) continue;

      const muscleGroups: string[] = [];
      for (const ex of session.exercises) {
        if (ex.muscle_group && !muscleGroups.includes(ex.muscle_group)) {
          muscleGroups.push(ex.muscle_group);
        }
      }

      await this.prisma.planDay.update({
        where: { id: day.id },
        data: {
          day_type: 'training',
          session_title: session.title,
          session_type: session.type,
          muscle_groups: muscleGroups,
          // Mirror the planning-time exercises_json shape so iOS
          // renders the linked workout consistently with planned days.
          exercises_json: session.exercises.map((ex) => ({
            library_exercise_id: ex.library_exercise_id,
            external_id: ex.external_id,
            name: ex.name,
            muscle_group: ex.muscle_group,
            equipment: ex.equipment,
            sets_display: ex.sets_display,
          })) as any,
          status: 'completed',
          workout_session_id: session.id,
          adapted_at: now,
        },
      });

      this.analytics.track(userId, 'plan_day_promoted_from_rest', {
        plan_id: plan.id,
        plan_day_id: day.id,
        session_id: session.id,
        day_of_week: day.day_of_week,
      });
    }
  }
}
