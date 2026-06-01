import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PlansAiService } from './plans-ai.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { toMondayDow } from '../common/date-utils';
import { formatSessionResponse } from '../common/format-session';
import { PlanGeneratorService } from './plan-generator.service';
import { PlanAdapterService } from './plan-adapter.service';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Public facade for plan-related operations. The heavy lifting lives in:
 *   - PlanGeneratorService — AI-driven plan creation (paywalled re-rolls).
 *   - PlanAdapterService   — week auto-advance + skipped-day redistribution.
 * What stays here:
 *   - getActivePlan: composes adapter + a transform for the API response.
 *   - startPlanSession / onSessionCompleted: the bridge between a PlanDay
 *     and a WorkoutSession. These need plan-day + workout-session writes
 *     in lockstep, which is the cleanest seam for "plan service" anyway.
 *   - Thin generatePlan / ensureCurrentPlan wrappers so callers that already
 *     inject PlansService don't have to switch.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansAiService: PlansAiService,
    private readonly analytics: AnalyticsService,
    private readonly planGenerator: PlanGeneratorService,
    private readonly planAdapter: PlanAdapterService,
  ) {}

  // ── Facade ─────────────────────────────────────────────────

  generatePlan(userId: string, force: boolean, focus?: string) {
    return this.planGenerator.generatePlan(userId, force, focus);
  }

  ensureCurrentPlan(userId: string): Promise<void> {
    return this.planAdapter.ensureCurrentPlan(userId);
  }

  // ── Active plan read (with adaptation + API transform) ────

  async getActivePlan(userId: string) {
    // Ensure the plan in the DB reflects today's reality (auto-advance +
    // skipped-day redistribution) before transforming for the API.
    await this.planAdapter.ensureCurrentPlan(userId);

    const plan = await this.prisma.trainingPlan.findFirst({
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
      // ensureCurrentPlan kicked off background generation when no plan
      // existed — return the placeholder so the client knows to poll.
      return {
        status: 'generating' as const,
        plan: null,
        days: [],
        todayIndex: 0,
      };
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    const absoluteTodayDow = toMondayDow(new Date());
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
      days: plan.days.map((day) => {
        const exercises = day.exercises_json as any[];
        return {
          id: day.id,
          dayOfWeek: day.day_of_week,
          dayLabel: DAY_LABELS[day.day_of_week] ?? 'Day',
          dayType: day.day_type,
          status: day.status,
          sessionTitle: day.session_title,
          sessionType: day.session_type,
          muscleGroups: day.muscle_groups,
          exercises: exercises.map((e: any, i: number) => ({
            name: e.name,
            muscleGroup: e.muscle_group,
            setsDisplay: e.sets_display,
            libraryExerciseId: e.library_exercise_id ?? null,
            accentColor: ACCENT_COLORS[i % ACCENT_COLORS.length],
            suggestedWeight: e.suggested_weight ?? null,
            imageUrl: exerciseImageUrl(e.external_id),
            externalId: e.external_id ?? null,
          })),
          workoutSession: day.workout_session
            ? {
                id: day.workout_session.id,
                durationMinutes: day.workout_session.duration_minutes,
                completedAt:
                  day.workout_session.completed_at?.toISOString() ?? null,
              }
            : null,
          aiNotes: day.ai_notes,
        };
      }),
      todayIndex,
    };
  }

  // ── Plan ↔ session bridge ─────────────────────────────────

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
      const existing = await this.prisma.workoutSession.findUnique({
        where: { id: planDay.workout_session_id },
        include: { exercises: { orderBy: { step_number: 'asc' } } },
      });
      if (existing && existing.status === 'active') {
        return formatSessionResponse(existing);
      }
    }

    const exercises = planDay.exercises_json as any[];

    // Validate library_exercise_ids still exist (seed script regenerates
    // UUIDs on deploy)
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
}
