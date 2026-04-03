import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PlansAiService } from './plans-ai.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { WeightSuggestionService } from '../home/weight-suggestion.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { matchSkeletonToDays } from './exercise-matcher';

const EQUIPMENT_MAP: Record<string, string[]> = {
  full_gym: [],
  dumbbells_only: ['Dumbbells', 'Bodyweight'],
  bodyweight: ['Bodyweight'],
  home_gym: ['Dumbbells', 'Bodyweight', 'Bands'],
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansAiService: PlansAiService,
    private readonly weightSuggestionService: WeightSuggestionService,
    private readonly analytics: AnalyticsService,
  ) {}

  async getActivePlan(userId: string) {
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
      // Generate new week in background — return current plan for now
      this.generatePlan(userId, true).catch(() => {});
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    // Calculate today's index as position within the returned days array
    const absoluteTodayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
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

  async generatePlan(userId: string, force: boolean) {
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

    // Calculate start day of week (0=Mon..6=Sun)
    const now = new Date();
    const jsDay = now.getDay(); // 0=Sun, 1=Mon..6=Sat
    const startDow = force ? 0 : jsDay === 0 ? 6 : jsDay - 1;

    // Fetch skeleton, exercise library, recent exercises, and previous week number in parallel
    const [skeleton, exerciseLibrary, recentExerciseIds, previousPlan] =
      await Promise.all([
        this.plansAiService.generateWeeklyPlan(userId, onboarding, startDow),
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
        this.prisma.trainingPlan.findFirst({
          where: { user_id: userId },
          orderBy: { week_number: 'desc' },
        }),
      ]);
    const newWeekNumber = (previousPlan?.week_number ?? 0) + 1;

    const generatedDays = matchSkeletonToDays(
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

    const weekStart = this.getWeekStart(now);

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

    if (planDay.workout_session_id) {
      // Session already exists, return it
      const existing = await this.prisma.workoutSession.findUnique({
        where: { id: planDay.workout_session_id },
        include: { exercises: { orderBy: { step_number: 'asc' } } },
      });
      if (existing && existing.status === 'active') {
        return this.formatSessionResponse(existing);
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
        status: 'proposed',
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

    return this.formatSessionResponse(session);
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

  private formatSessionResponse(session: any) {
    return {
      id: session.id,
      user_id: session.user_id,
      title: session.title,
      type: session.type,
      status: session.status,
      started_at: session.started_at?.toISOString() ?? null,
      completed_at: session.completed_at?.toISOString() ?? null,
      duration_minutes: session.duration_minutes,
      ai_generated: session.ai_generated,
      ai_message: session.ai_message,
      created_at: session.created_at.toISOString(),
      updated_at: session.updated_at.toISOString(),
      exercises: session.exercises.map((e: any) => ({
        id: e.id,
        name: e.name,
        step_number: e.step_number,
        sets_display: e.sets_display,
        accent_color: e.accent_color,
        library_exercise_id: e.library_exercise_id ?? null,
        muscle_group: e.muscle_group ?? null,
        equipment: e.equipment ?? null,
        suggested_weight: e.suggested_weight ?? null,
        image_url: exerciseImageUrl(e.external_id),
      })),
    };
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

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
