import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  CompleteSessionDto,
  CreateSessionDto,
  FeedbackDto,
} from './dto/home.dto';
import { ACCENT_COLORS } from './session-exercise.service';
import { HomeAiService } from './home-ai.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly homeAiService: HomeAiService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────

  async getDashboard(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const todayStr = now.toISOString().split('T')[0];

    const [profile, completedSessions, quickWorkout, todayHistory, motivation, activePlan] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { full_name: true, email: true, avatar_url: true },
        }),
        this.prisma.workoutSession.findMany({
          where: {
            user_id: userId,
            status: 'completed',
            completed_at: { gte: weekStart, lt: weekEnd },
          },
          include: {
            exercises: {
              include: { exercise_sets: true },
            },
          },
        }),
        this.prisma.workoutSession.findFirst({
          where: { user_id: userId, status: 'proposed' },
          orderBy: { created_at: 'desc' },
          include: {
            exercises: {
              orderBy: { step_number: 'asc' },
            },
          },
        }),
        this.getSessionHistory(userId, todayStr),
        this.homeAiService.getOrGenerateMotivation(userId),
        this.prisma.trainingPlan.findFirst({
          where: { user_id: userId, is_active: true },
          include: { days: { orderBy: { day_of_week: 'asc' } } },
        }),
      ]);

    const name = profile?.full_name ?? profile?.email?.split('@')[0] ?? '';

    const weekCompletedDays = [
      ...new Set(
        completedSessions
          .filter((s) => s.completed_at !== null)
          .map((s) => (s.completed_at as Date).getDay()),
      ),
    ];

    let finalQuickWorkout = quickWorkout;
    if (!finalQuickWorkout) {
      // Generate in background — will be available on next dashboard load
      this.homeAiService.generateQuickWorkout(userId).catch(() => {});
    }

    // Compute today's plan day
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const todayPlanDay = activePlan?.days.find(
      (d) => d.day_of_week === todayDow,
    );

    let plannedWorkout: any = null;
    let weekWorkoutsTotal: number | null = null;
    let weekWorkoutsCompleted: number | null = null;

    if (activePlan && todayPlanDay) {
      const trainingDays = activePlan.days.filter(
        (d) => d.day_type === 'training',
      );
      weekWorkoutsTotal = trainingDays.length;
      weekWorkoutsCompleted = activePlan.days.filter(
        (d) => d.status === 'completed',
      ).length;

      if (todayPlanDay.day_type === 'rest') {
        plannedWorkout = { type: 'rest' };
      } else {
        const exercises = todayPlanDay.exercises_json as any[];
        plannedWorkout = {
          type: 'training',
          plan_day_id: todayPlanDay.id,
          session_title: todayPlanDay.session_title,
          session_type: todayPlanDay.session_type,
          muscle_groups: todayPlanDay.muscle_groups,
          status: todayPlanDay.status,
          exercises: exercises.map((e: any, i: number) => ({
            name: e.name,
            muscle_group: e.muscle_group,
            sets_display: e.sets_display,
            library_exercise_id: e.library_exercise_id ?? null,
            accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
            suggested_weight: e.suggested_weight ?? null,
          })),
        };
      }
    }

    // Compute week volume in kg
    let weekVolumeKg = 0;
    for (const session of completedSessions) {
      for (const exercise of session.exercises) {
        for (const set of exercise.exercise_sets) {
          if (set.weight && set.reps) {
            let weightKg = Number(set.weight);
            if (set.weight_unit === 'lbs') {
              weightKg *= 0.453592;
            }
            weekVolumeKg += weightKg * set.reps;
          }
        }
      }
    }

    // Compute avg duration and total calories from completed sessions
    const durationsMinutes = completedSessions
      .map((s) => s.duration_minutes)
      .filter((d): d is number => d !== null);
    const weekAvgDurationMinutes =
      durationsMinutes.length > 0
        ? Math.round(
            durationsMinutes.reduce((a, b) => a + b, 0) /
              durationsMinutes.length,
          )
        : null;
    const weekTotalCalories = completedSessions.reduce(
      (sum, s) => sum + (s.calories ?? 0),
      0,
    );

    // Compute week streak: consecutive days ending at today (or yesterday)
    const todayDayIndex = now.getDay(); // 0=Sun
    const completedDaySet = new Set(weekCompletedDays);
    let weekStreak = 0;
    let checkDay = todayDayIndex;
    // If today has no workout, start from yesterday
    if (!completedDaySet.has(checkDay)) {
      checkDay = checkDay === 0 ? 6 : checkDay - 1;
    }
    // Count consecutive days backwards
    for (let i = 0; i < 7; i++) {
      if (completedDaySet.has(checkDay)) {
        weekStreak++;
        checkDay = checkDay === 0 ? 6 : checkDay - 1;
      } else {
        break;
      }
    }

    return {
      user: { name, avatar_url: profile?.avatar_url ?? null },
      motivation: motivation
        ? {
            title: motivation.title,
            message: motivation.message,
            workouts_this_week: motivation.workouts_this_week,
            personal_records: motivation.personal_records,
          }
        : null,
      week_completed_days: weekCompletedDays,
      quick_workout: finalQuickWorkout
        ? {
            id: finalQuickWorkout.id,
            title: finalQuickWorkout.title,
            type: finalQuickWorkout.type,
            duration_minutes: finalQuickWorkout.duration_minutes,
            ai_message: finalQuickWorkout.ai_message,
            exercises: finalQuickWorkout.exercises.map((e: any) => ({
              id: e.id,
              name: e.name,
              step_number: e.step_number,
              sets_display: e.sets_display,
              accent_color: e.accent_color,
              library_exercise_id: e.library_exercise_id ?? null,
              muscle_group: e.muscle_group ?? null,
              equipment: e.equipment ?? null,
              suggested_weight: e.suggested_weight ?? null,
            })),
          }
        : null,
      planned_workout: plannedWorkout,
      week_workouts_total: weekWorkoutsTotal,
      week_workouts_completed: weekWorkoutsCompleted,
      week_volume_kg: Math.round(weekVolumeKg),
      week_streak: weekStreak,
      week_avg_duration_minutes: weekAvgDurationMinutes,
      week_total_calories: weekTotalCalories || null,
      today_completed_session: todayHistory.session,
    };
  }

  async getWeekCalendar(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: weekStart, lt: weekEnd },
      },
      select: { completed_at: true },
    });

    const completedDays = [
      ...new Set(
        sessions
          .filter((s) => s.completed_at !== null)
          .map((s) => (s.completed_at as Date).getDay()),
      ),
    ];

    return { completed_days: completedDays };
  }

  // ── Session Lifecycle ────────────────────────────────────

  async startSession(userId: string, sessionId: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (session.status !== 'proposed') {
      throw new AppException(
        'invalid_session_status',
        `Cannot start a session with status '${session.status}'`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.workoutSession.update({
      where: { id: sessionId },
      data: {
        status: 'active',
        started_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
        },
      },
    });

    return this.formatSession(updated);
  }

  async createSession(userId: string, dto: CreateSessionDto) {
    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: dto.title,
        type: dto.type,
        status: 'active',
        started_at: new Date(),
        duration_minutes: dto.duration_minutes ?? null,
        ai_generated: false,
        updated_at: new Date(),
      },
      include: {
        exercises: true,
      },
    });

    return this.formatSession(session);
  }

  async completeSession(
    userId: string,
    sessionId: string,
    dto: CompleteSessionDto,
  ) {
    try {
      const session = await this.prisma.workoutSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (session.status !== 'active') {
      throw new AppException(
        'invalid_session_status',
        `Cannot complete a session with status '${session.status}'`,
        HttpStatus.CONFLICT,
      );
    }

    const completedAt = new Date();
    const durationMinutes =
      dto.duration_minutes ??
      (session.started_at
        ? Math.round(
            (completedAt.getTime() - session.started_at.getTime()) / 60000,
          )
        : null);

    // MET-based calorie estimation
    let calories: number | null = null;
    if (durationMinutes && dto.feedback?.effort_level) {
      const effort = dto.feedback.effort_level;
      let met: number;
      if (effort <= 3) met = 3.5;
      else if (effort <= 6) met = 5.0;
      else if (effort <= 8) met = 6.0;
      else met = 7.0;
      calories = Math.round(met * 70 * (durationMinutes / 60));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workoutSession.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          completed_at: completedAt,
          duration_minutes: durationMinutes,
          calories,
          updated_at: new Date(),
        },
      });

      if (dto.feedback) {
        await tx.sessionFeedback.upsert({
          where: { session_id: sessionId },
          create: {
            session_id: sessionId,
            effort_level: dto.feedback.effort_level,
            energy_level: dto.feedback.energy_level,
            pain_discomfort: dto.feedback.pain_discomfort ?? 'None',
          },
          update: {
            effort_level: dto.feedback.effort_level,
            energy_level: dto.feedback.energy_level,
            pain_discomfort: dto.feedback.pain_discomfort ?? 'None',
          },
        });
      }
    });

    this.analytics.track(userId, 'session_completed', {
      duration_minutes: durationMinutes,
      calories,
      effort_level: dto.feedback?.effort_level ?? null,
    });

    // Invalidate cached motivation so the next dashboard load regenerates it
    // with the just-completed session included
    await this.prisma.motivationInsight.deleteMany({
      where: { user_id: userId },
    });

    // Update plan day status if this session is linked to a plan
    const linkedPlanDay = await this.prisma.planDay.findFirst({
      where: { workout_session_id: sessionId },
    });
    if (linkedPlanDay) {
      await this.prisma.planDay.update({
        where: { id: linkedPlanDay.id },
        data: { status: 'completed' },
      });
    }

    const fullSession = await this.prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
        },
        feedback: true,
      },
    });

    return {
      ...this.formatSession(fullSession),
      calories: fullSession.calories ?? null,
      performance_score: fullSession.performance_score ?? null,
      feedback: fullSession.feedback
        ? {
            effort_level: fullSession.feedback.effort_level,
            energy_level: fullSession.feedback.energy_level,
            pain_discomfort: fullSession.feedback.pain_discomfort,
          }
        : null,
    };
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException('completion_failed', 'Failed to complete session', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ── Feedback ─────────────────────────────────────────────

  async submitFeedback(userId: string, sessionId: string, dto: FeedbackDto) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const feedback = await this.prisma.sessionFeedback.upsert({
      where: { session_id: sessionId },
      create: {
        session_id: sessionId,
        effort_level: dto.effort_level,
        energy_level: dto.energy_level,
        pain_discomfort: dto.pain_discomfort ?? 'None',
      },
      update: {
        effort_level: dto.effort_level,
        energy_level: dto.energy_level,
        pain_discomfort: dto.pain_discomfort ?? 'None',
      },
    });

    return {
      id: feedback.id,
      session_id: feedback.session_id,
      effort_level: feedback.effort_level,
      energy_level: feedback.energy_level,
      pain_discomfort: feedback.pain_discomfort,
      created_at: feedback.created_at.toISOString(),
    };
  }

  // ── History ──────────────────────────────────────────────

  async getSessionHistory(userId: string, date: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const session = await this.prisma.workoutSession.findFirst({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: {
            exercise_sets: { orderBy: { set_number: 'asc' } },
          },
        },
      },
    });

    if (!session) {
      return { date, session: null };
    }

    return {
      date,
      session: {
        id: session.id,
        title: session.title,
        type: session.type,
        status: session.status,
        duration_minutes: session.duration_minutes,
        calories: session.calories,
        performance_score: session.performance_score,
        started_at: session.started_at?.toISOString() ?? null,
        completed_at: session.completed_at?.toISOString() ?? null,
        exercises: session.exercises.map((e, index) => ({
          id: e.id,
          name: e.name,
          muscle_group: e.muscle_group,
          accent_color: ACCENT_COLORS[index % ACCENT_COLORS.length],
          step_number: e.step_number,
          sets: e.exercise_sets.map((s) => ({
            set_number: s.set_number,
            weight: s.weight ? Number(s.weight) : null,
            weight_unit: s.weight_unit,
            reps: s.reps,
          })),
        })),
      },
    };
  }

  async getCompletedDays(userId: string, month: string) {
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(
      startOfMonth.getFullYear(),
      startOfMonth.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const sessions = await this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: startOfMonth, lte: endOfMonth },
      },
      select: { completed_at: true },
    });

    const completedDates = [
      ...new Set(
        sessions
          .filter((s) => s.completed_at !== null)
          .map((s) => (s.completed_at as Date).toISOString().split('T')[0]),
      ),
    ];

    return { month, completed_dates: completedDates };
  }

  // ── Private Helpers ──────────────────────────────────────

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    const diff = day === 0 ? -6 : 1 - day; // shift to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatSession(session: {
    id: string;
    user_id: string;
    title: string;
    type: string;
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    duration_minutes: number | null;
    ai_generated: boolean;
    ai_message: string | null;
    created_at: Date;
    updated_at: Date;
    exercises: {
      id: string;
      name: string;
      step_number: number;
      sets_display: string;
      accent_color: string;
      library_exercise_id: string | null;
      muscle_group: string | null;
      equipment: string | null;
      suggested_weight: number | null;
    }[];
  }) {
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
      exercises: session.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        step_number: e.step_number,
        sets_display: e.sets_display,
        accent_color: e.accent_color,
        library_exercise_id: e.library_exercise_id ?? null,
        muscle_group: e.muscle_group ?? null,
        equipment: e.equipment ?? null,
        suggested_weight: e.suggested_weight ?? null,
      })),
    };
  }
}
