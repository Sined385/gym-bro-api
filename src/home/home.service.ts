import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  CompleteSessionDto,
  CompleteSessionFullDto,
  CreateSessionDto,
  FeedbackDto,
} from './dto/home.dto';
import { ACCENT_COLORS } from './session-exercise.service';
import { HomeAiService } from './home-ai.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { getWeekStart, toMondayDow } from '../common/date-utils';
import { formatSessionResponse } from '../common/format-session';
import { ChallengesService } from './challenges.service';
import { WorkoutOrchestratorService } from '../workouts/workout-orchestrator.service';

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly homeAiService: HomeAiService,
    private readonly analytics: AnalyticsService,
    private readonly challengesService: ChallengesService,
    private readonly orchestrator: WorkoutOrchestratorService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────

  async getDashboard(userId: string) {
    const now = new Date();
    const weekStart = getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const todayStr = now.toISOString().split('T')[0];

    const prev3WeeksStart = new Date(
      weekStart.getTime() - 3 * 7 * 24 * 60 * 60 * 1000,
    );
    const prev3WeeksEnd = weekStart;

    const [
      profile,
      completedSessions,
      prev3WeeksSessions,
      quickWorkout,
      todayHistory,
      motivation,
      activePlan,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          full_name: true,
          email: true,
          avatar_url: true,
          is_premium: true,
        },
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
      this.prisma.workoutSession.findMany({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: prev3WeeksStart, lt: prev3WeeksEnd },
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

    const finalQuickWorkout = quickWorkout;
    if (!finalQuickWorkout) {
      // Generate in background — will be available on next dashboard load
      this.homeAiService.generateQuickWorkout(userId).catch(() => {});
    }

    // Compute today's plan day
    const todayDow = toMondayDow(now);
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
      weekWorkoutsCompleted = completedSessions.length;

      if (todayPlanDay.day_type === 'rest') {
        plannedWorkout = { type: 'rest' };
      } else {
        const exercises = todayPlanDay.exercises_json as any[];

        // Backfill missing external_id by looking up exercise library by name
        const missingNames = exercises
          .filter((e: any) => !e.external_id)
          .map((e: any) => e.name);
        const nameToExternalId: Record<string, string> = {};
        if (missingNames.length > 0) {
          const found = await this.prisma.exerciseLibrary.findMany({
            where: { name: { in: missingNames }, is_system: true },
            select: { name: true, external_id: true },
          });
          for (const f of found) {
            if (f.external_id) nameToExternalId[f.name] = f.external_id;
          }
        }

        plannedWorkout = {
          type: 'training',
          plan_day_id: todayPlanDay.id,
          session_title: todayPlanDay.session_title,
          session_type: todayPlanDay.session_type,
          muscle_groups: todayPlanDay.muscle_groups,
          status: todayPlanDay.status,
          exercises: exercises.map((e: any, i: number) => {
            const extId = e.external_id ?? nameToExternalId[e.name] ?? null;
            return {
              name: e.name,
              muscle_group: e.muscle_group,
              sets_display: e.sets_display,
              library_exercise_id: e.library_exercise_id ?? null,
              accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
              suggested_weight: e.suggested_weight ?? null,
              image_url: exerciseImageUrl(extId),
              external_id: extId,
            };
          }),
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

    // Compute previous 3 weeks averages
    let prev3AvgWorkouts: number | null = null;
    let prev3AvgVolumeKg: number | null = null;
    let prev3AvgDurationMinutes: number | null = null;
    let prev3AvgCalories: number | null = null;

    const hasPrev3WeeksData = prev3WeeksSessions.length > 0;
    if (hasPrev3WeeksData) {
      let totalVolume = 0;
      for (const session of prev3WeeksSessions) {
        for (const exercise of session.exercises) {
          for (const set of exercise.exercise_sets) {
            if (set.weight && set.reps) {
              let weightKg = Number(set.weight);
              if (set.weight_unit === 'lbs') {
                weightKg *= 0.453592;
              }
              totalVolume += weightKg * set.reps;
            }
          }
        }
      }

      const prevDurations = prev3WeeksSessions
        .map((s) => s.duration_minutes)
        .filter((d): d is number => d !== null);
      const prevTotalCalories = prev3WeeksSessions.reduce(
        (sum, s) => sum + (s.calories ?? 0),
        0,
      );

      prev3AvgWorkouts = prev3WeeksSessions.length / 3;
      prev3AvgVolumeKg = Math.round(totalVolume / 3);
      prev3AvgDurationMinutes =
        prevDurations.length > 0
          ? Math.round(
              prevDurations.reduce((a, b) => a + b, 0) / prevDurations.length,
            )
          : null;
      prev3AvgCalories = Math.round(prevTotalCalories / 3);
    }

    // Generate AI weekly overview
    let weeklyOverview: string | null = null;
    try {
      weeklyOverview = await this.homeAiService.getOrGenerateWeeklyOverview(
        userId,
        {
          workouts: completedSessions.length,
          volumeKg: weekVolumeKg,
          avgDurationMinutes: weekAvgDurationMinutes,
          totalCalories: weekTotalCalories,
        },
        hasPrev3WeeksData
          ? {
              workouts: prev3AvgWorkouts!,
              volumeKg: prev3AvgVolumeKg!,
              avgDurationMinutes: prev3AvgDurationMinutes ?? 0,
              totalCalories: prev3AvgCalories!,
            }
          : null,
      );
    } catch {
      // Non-critical — proceed without overview
    }

    const [dailyChallenge, tomorrowChallenge] = await Promise.all([
      this.challengesService.getDailyChallenge(userId, now),
      this.challengesService.getTomorrowChallenge(userId, now),
    ]);

    return {
      user: {
        name,
        avatar_url: profile?.avatar_url ?? null,
        is_premium: profile?.is_premium ?? false,
      },
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
              image_url: exerciseImageUrl(e.external_id),
              external_id: e.external_id ?? null,
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
      weekly_overview: weeklyOverview,
      prev3_avg_workouts: prev3AvgWorkouts,
      prev3_avg_volume_kg: prev3AvgVolumeKg,
      prev3_avg_duration_minutes: prev3AvgDurationMinutes,
      prev3_avg_calories: prev3AvgCalories,
      today_completed_session: todayHistory.session,
      daily_challenge: dailyChallenge,
      tomorrow_challenge: tomorrowChallenge,
    };
  }

  async getWeekCalendar(userId: string) {
    const now = new Date();
    const weekStart = getWeekStart(now);
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

    this.analytics.track(userId, 'session_started', {
      session_id: updated.id,
      title: updated.title,
      type: updated.type,
    });

    return formatSessionResponse(updated);
  }

  async createSession(userId: string, dto: CreateSessionDto) {
    const now = new Date();
    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: dto.title,
        type: dto.type,
        status: 'active',
        started_at: now,
        duration_minutes: dto.duration_minutes ?? null,
        ai_generated: false,
        updated_at: now,
      },
      include: {
        exercises: true,
      },
    });

    return formatSessionResponse(session);
  }

  async cancelSession(userId: string, sessionId: string) {
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

    if (session.status !== 'proposed' && session.status !== 'active') {
      throw new AppException(
        'invalid_session_status',
        `Cannot cancel a session with status '${session.status}'`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const linkedPlanDay = await tx.planDay.findFirst({
        where: { workout_session_id: sessionId },
      });
      if (linkedPlanDay) {
        await tx.planDay.update({
          where: { id: linkedPlanDay.id },
          data: { status: 'pending', workout_session_id: null },
        });
      }

      return tx.workoutSession.update({
        where: { id: sessionId },
        data: {
          status: 'cancelled',
          updated_at: new Date(),
        },
        include: {
          exercises: {
            orderBy: { step_number: 'asc' },
          },
        },
      });
    });

    this.analytics.track(userId, 'session_cancelled', {
      session_id: updated.id,
      previous_status: session.status,
      had_exercises: updated.exercises.length > 0,
    });

    return formatSessionResponse(updated);
  }

  async completeSession(
    userId: string,
    sessionId: string,
    dto: CompleteSessionDto,
  ) {
    try {
      const session = await this.findActiveSession(userId, sessionId);

      const completedAt = new Date();
      const durationMinutes = this.calculateDuration(dto, session, completedAt);
      const calories = this.estimateCalories(
        durationMinutes,
        dto.feedback?.effort_level,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.workoutSession.update({
          where: { id: sessionId },
          data: {
            status: 'completed',
            completed_at: completedAt,
            duration_minutes: durationMinutes,
            calories,
            avg_heart_rate: dto.avg_heart_rate ?? null,
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

      await this.postCompletionEffects(
        userId,
        sessionId,
        durationMinutes,
        calories,
        dto.feedback?.effort_level,
      );

      return this.fetchCompletedSession(sessionId);
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        'completion_failed',
        'Failed to complete session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async completeSessionFull(
    userId: string,
    sessionId: string,
    dto: CompleteSessionFullDto,
  ) {
    const session = await this.findActiveSession(userId, sessionId);

    const completedAt = new Date();
    const durationMinutes = this.calculateDuration(dto, session, completedAt);
    const calories = this.estimateCalories(
      durationMinutes,
      dto.feedback?.effort_level,
    );

    // Look up external_ids for library exercises
    const libraryIds = dto.exercises
      .map((e) => e.library_exercise_id)
      .filter((id): id is string => !!id);
    const libraryMap =
      libraryIds.length > 0
        ? new Map(
            (
              await this.prisma.exerciseLibrary.findMany({
                where: { id: { in: libraryIds } },
                select: { id: true, external_id: true },
              })
            ).map((e) => [e.id, e.external_id]),
          )
        : new Map<string, string | null>();

    await this.prisma.$transaction(async (tx) => {
      // Delete existing exercises and recreate from payload
      await tx.exerciseSet.deleteMany({
        where: { exercise: { session_id: sessionId } },
      });
      await tx.sessionExercise.deleteMany({
        where: { session_id: sessionId },
      });

      for (const exDto of dto.exercises) {
        const externalId = exDto.library_exercise_id
          ? (libraryMap.get(exDto.library_exercise_id) ?? null)
          : null;

        const exercise = await tx.sessionExercise.create({
          data: {
            session_id: sessionId,
            library_exercise_id: exDto.library_exercise_id ?? null,
            external_id: externalId,
            name: exDto.name,
            muscle_group: exDto.muscle_group,
            equipment: exDto.equipment ?? null,
            step_number: exDto.step_number,
            accent_color:
              exDto.accent_color ??
              ACCENT_COLORS[(exDto.step_number - 1) % ACCENT_COLORS.length],
            superset_group_id: exDto.superset_group_id ?? null,
            superset_order: exDto.superset_order ?? null,
            sets_display: '',
          },
        });

        if (exDto.sets?.length) {
          await tx.exerciseSet.createMany({
            data: exDto.sets.map((s) => {
              const isBodyweight = s.is_bodyweight ?? false;
              return {
                exercise_id: exercise.id,
                set_number: s.set_number,
                // Force-null weight when the set is flagged bodyweight, so the
                // DB shape never says "Bodyweight × 8 at 0kg" by mistake.
                weight: isBodyweight ? null : (s.weight ?? null),
                weight_unit: s.weight_unit ?? 'kg',
                reps: s.reps,
                is_completed: s.is_completed ?? true,
                is_bodyweight: isBodyweight,
              };
            }),
          });
        }
      }

      await tx.workoutSession.update({
        where: { id: sessionId },
        data: {
          title: dto.title ?? session.title,
          status: 'completed',
          completed_at: completedAt,
          duration_minutes: durationMinutes,
          calories,
          avg_heart_rate: dto.avg_heart_rate ?? null,
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

    await this.postCompletionEffects(
      userId,
      sessionId,
      durationMinutes,
      calories,
      dto.feedback?.effort_level,
    );

    return this.fetchCompletedSession(sessionId);
  }

  // ── Completion Helpers ──────────────────────────────────

  private async findActiveSession(userId: string, sessionId: string) {
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

    return session;
  }

  private calculateDuration(
    dto: { duration_minutes?: number | null },
    session: { started_at: Date | null },
    completedAt: Date,
  ): number | null {
    const MAX_SESSION_DURATION = 240; // 4 hours — cap unrealistic durations
    const rawDuration =
      dto.duration_minutes ??
      (session.started_at
        ? Math.round(
            (completedAt.getTime() - session.started_at.getTime()) / 60000,
          )
        : null);
    return rawDuration !== null
      ? Math.min(rawDuration, MAX_SESSION_DURATION)
      : null;
  }

  private estimateCalories(
    durationMinutes: number | null,
    effortLevel?: number,
  ): number | null {
    if (!durationMinutes || !effortLevel) return null;
    let met: number;
    if (effortLevel <= 3) met = 3.5;
    else if (effortLevel <= 6) met = 5.0;
    else if (effortLevel <= 8) met = 6.0;
    else met = 7.0;
    return Math.round(met * 70 * (durationMinutes / 60));
  }

  /**
   * Thin call site — the orchestrator owns the actual cache
   * invalidations, plan-day linkage, AI completion notes, analytics,
   * and reminder recalc. Phase 1 moves the prior inline body into
   * WorkoutOrchestratorService.recordCompletion.
   */
  private async postCompletionEffects(
    userId: string,
    sessionId: string,
    durationMinutes: number | null,
    calories: number | null,
    effortLevel?: number,
  ): Promise<void> {
    await this.orchestrator.recordCompletion(userId, sessionId, {
      durationMinutes,
      calories,
      effortLevel,
    });
  }

  private async fetchCompletedSession(sessionId: string) {
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
      ...formatSessionResponse(fullSession),
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

    const sessions = await this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { completed_at: 'asc' },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: {
            exercise_sets: { orderBy: { set_number: 'asc' } },
          },
        },
      },
    });

    if (sessions.length === 0) {
      return { date, session: null };
    }

    // Merge all sessions into one summary
    const totalDuration = sessions.reduce(
      (sum, s) => sum + (s.duration_minutes ?? 0),
      0,
    );
    const totalCalories = sessions.reduce(
      (sum, s) => sum + (s.calories ?? 0),
      0,
    );
    // Average heart rate across sessions, ignoring nulls (no Watch).
    const hrSamples = sessions
      .map((s) => s.avg_heart_rate)
      .filter((hr): hr is number => hr !== null && hr !== undefined);
    const avgHeartRate =
      hrSamples.length > 0
        ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length)
        : null;
    const scores = sessions
      .map((s) => s.performance_score)
      .filter((s): s is number => s !== null);
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    // Flatten all exercises with continuous step numbering and accent colors
    const allExercises = sessions.flatMap((s) => s.exercises);

    const first = sessions[0];
    const last = sessions[sessions.length - 1];
    const title =
      sessions.length === 1 ? first.title : `${sessions.length} Workouts`;

    return {
      date,
      session: {
        id: first.id,
        session_ids: sessions.map((s) => s.id),
        title,
        type: first.type,
        status: 'completed',
        duration_minutes: totalDuration || null,
        calories: totalCalories || null,
        avg_heart_rate: avgHeartRate,
        performance_score: avgScore,
        started_at: first.started_at?.toISOString() ?? null,
        completed_at: last.completed_at?.toISOString() ?? null,
        exercises: allExercises.map((e, index) => ({
          id: e.id,
          name: e.name,
          muscle_group: e.muscle_group,
          accent_color: ACCENT_COLORS[index % ACCENT_COLORS.length],
          step_number: index + 1,
          image_url: exerciseImageUrl(e.external_id),
          external_id: e.external_id ?? null,
          sets: e.exercise_sets.map((s) => ({
            set_number: s.set_number,
            weight: s.weight ? Number(s.weight) : null,
            weight_unit: s.weight_unit,
            reps: s.reps,
            is_bodyweight: s.is_bodyweight,
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
}
