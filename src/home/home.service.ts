import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  AddExercisesDto,
  CompleteSessionDto,
  CreateSessionDto,
  CreateSupersetDto,
  FeedbackDto,
  LogSetDto,
  UpdateSetDto,
} from './dto/home.dto';

const ACCENT_COLORS = ['#E86A75', '#30C08D', '#7A82F6', '#F5A623'];

const EQUIPMENT_MAP: Record<string, string[]> = {
  full_gym: [], // empty means all equipment allowed
  dumbbells_only: ['Dumbbells', 'Bodyweight'],
  bodyweight: ['Bodyweight'],
  home_gym: ['Dumbbells', 'Bodyweight', 'Bands'],
};

const SETS_DISPLAY_BY_GOAL: Record<string, string> = {
  build_muscle: '3 × 10',
  lose_fat: '3 × 12',
  get_stronger: '4 × 6',
  improve_endurance: '3 × 15',
  stay_healthy: '3 × 10',
};

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────

  private async verifyActiveSession(userId: string, sessionId: string) {
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
        `Session is not active (status: '${session.status}')`,
        HttpStatus.CONFLICT,
      );
    }

    return session;
  }

  private async verifyExerciseOwnership(sessionId: string, exerciseId: string) {
    const exercise = await this.prisma.sessionExercise.findFirst({
      where: { id: exerciseId, session_id: sessionId },
    });

    if (!exercise) {
      throw new AppException(
        'exercise_not_found',
        'Exercise not found in this session',
        HttpStatus.NOT_FOUND,
      );
    }

    return exercise;
  }

  private async verifySetOwnership(exerciseId: string, setId: string) {
    const set = await this.prisma.exerciseSet.findFirst({
      where: { id: setId, exercise_id: exerciseId },
    });

    if (!set) {
      throw new AppException(
        'set_not_found',
        'Set not found for this exercise',
        HttpStatus.NOT_FOUND,
      );
    }

    return set;
  }

  // ── Dashboard ────────────────────────────────────────────

  async getDashboard(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const todayStr = now.toISOString().split('T')[0];

    const [profile, motivation, completedSessions, proposedSession, todayHistory] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { full_name: true, email: true, avatar_url: true },
        }),
        this.prisma.motivationInsight.findFirst({
          where: {
            user_id: userId,
            OR: [{ valid_until: null }, { valid_until: { gt: now } }],
          },
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.workoutSession.findMany({
          where: {
            user_id: userId,
            status: 'completed',
            completed_at: { gte: weekStart, lt: weekEnd },
          },
          select: { completed_at: true },
        }),
        this.prisma.workoutSession.findFirst({
          where: { user_id: userId, status: 'proposed' },
          orderBy: { created_at: 'desc' },
          include: {
            exercises: { orderBy: { step_number: 'asc' } },
          },
        }),
        this.getSessionHistory(userId, todayStr),
      ]);

    const name = profile?.full_name ?? profile?.email?.split('@')[0] ?? '';

    const weekCompletedDays = [
      ...new Set(
        completedSessions
          .filter((s) => s.completed_at !== null)
          .map((s) => (s.completed_at as Date).getDay()),
      ),
    ];

    let finalProposedSession = proposedSession;
    if (!finalProposedSession) {
      finalProposedSession = await this.generateProposedSession(userId);
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
      proposed_session: finalProposedSession
        ? {
            id: finalProposedSession.id,
            title: finalProposedSession.title,
            type: finalProposedSession.type,
            duration_minutes: finalProposedSession.duration_minutes,
            ai_message: finalProposedSession.ai_message,
            exercises: finalProposedSession.exercises.map((e) => ({
              id: e.id,
              name: e.name,
              step_number: e.step_number,
              sets_display: e.sets_display,
              accent_color: e.accent_color,
              library_exercise_id: e.library_exercise_id ?? null,
              muscle_group: e.muscle_group ?? null,
              equipment: e.equipment ?? null,
            })),
          }
        : null,
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
      include: { exercises: { orderBy: { step_number: 'asc' } } },
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
      include: { exercises: true },
    });

    return this.formatSession(session);
  }

  async completeSession(
    userId: string,
    sessionId: string,
    dto: CompleteSessionDto,
  ) {
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

    await this.prisma.$transaction(async (tx) => {
      await tx.workoutSession.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          completed_at: completedAt,
          duration_minutes: durationMinutes,
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

    const fullSession = await this.prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        exercises: { orderBy: { step_number: 'asc' } },
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
  }

  // ── Session Exercises ────────────────────────────────────

  async addExercises(userId: string, sessionId: string, dto: AddExercisesDto) {
    await this.verifyActiveSession(userId, sessionId);

    const maxStep = await this.prisma.sessionExercise.aggregate({
      where: { session_id: sessionId },
      _max: { step_number: true },
    });

    let currentStep = maxStep._max.step_number ?? 0;

    const created: any[] = [];
    for (const item of dto.exercises) {
      currentStep++;
      const exercise = await this.prisma.sessionExercise.create({
        data: {
          session_id: sessionId,
          library_exercise_id: item.library_exercise_id ?? null,
          name: item.name,
          muscle_group: item.muscle_group,
          equipment: item.equipment ?? null,
          step_number: currentStep,
          accent_color: ACCENT_COLORS[(currentStep - 1) % ACCENT_COLORS.length],
          sets_display: '',
        },
        include: { exercise_sets: true },
      });
      created.push({
        id: exercise.id,
        library_exercise_id: exercise.library_exercise_id,
        name: exercise.name,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        step_number: exercise.step_number,
        accent_color: exercise.accent_color,
        sets: [],
      });
    }

    return { exercises: created };
  }

  async createSuperset(
    userId: string,
    sessionId: string,
    dto: CreateSupersetDto,
  ) {
    await this.verifyActiveSession(userId, sessionId);

    // Verify all exercise_ids belong to this session
    const exercises = await this.prisma.sessionExercise.findMany({
      where: { id: { in: dto.exercise_ids }, session_id: sessionId },
    });

    if (exercises.length !== dto.exercise_ids.length) {
      throw new AppException(
        'exercise_not_found',
        'One or more exercises not found in this session',
        HttpStatus.NOT_FOUND,
      );
    }

    const supersetGroupId = randomUUID();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const results: {
      id: string;
      name: string;
      superset_group_id: string | null;
      superset_order: string | null;
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dto.exercise_ids.length; i++) {
        const ex = await tx.sessionExercise.update({
          where: { id: dto.exercise_ids[i] },
          data: {
            superset_group_id: supersetGroupId,
            superset_order: letters[i],
          },
        });
        results.push({
          id: ex.id,
          name: ex.name,
          superset_group_id: ex.superset_group_id,
          superset_order: ex.superset_order,
        });
      }
    });

    return { superset_group_id: supersetGroupId, exercises: results };
  }

  async removeExercise(userId: string, sessionId: string, exerciseId: string) {
    await this.verifyActiveSession(userId, sessionId);
    const exercise = await this.verifyExerciseOwnership(sessionId, exerciseId);

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionExercise.delete({ where: { id: exerciseId } });

      // If the deleted exercise was in a superset, check remaining members
      if (exercise.superset_group_id) {
        const remaining = await tx.sessionExercise.findMany({
          where: { superset_group_id: exercise.superset_group_id },
        });

        if (remaining.length === 1) {
          await tx.sessionExercise.update({
            where: { id: remaining[0].id },
            data: { superset_group_id: null, superset_order: null },
          });
        }
      }
    });

    return { deleted: true };
  }

  async logSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    dto: LogSetDto,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);

    const set = await this.prisma.exerciseSet.create({
      data: {
        exercise_id: exerciseId,
        set_number: dto.set_number,
        weight: dto.weight ?? null,
        weight_unit: dto.weight_unit ?? 'lbs',
        reps: dto.reps,
        is_completed: true,
      },
    });

    return {
      id: set.id,
      exercise_id: set.exercise_id,
      set_number: set.set_number,
      weight: set.weight ? Number(set.weight) : null,
      weight_unit: set.weight_unit,
      reps: set.reps,
      is_completed: set.is_completed,
      created_at: set.created_at.toISOString(),
    };
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
    dto: UpdateSetDto,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);
    await this.verifySetOwnership(exerciseId, setId);

    const data: any = {};
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.weight_unit !== undefined) data.weight_unit = dto.weight_unit;
    if (dto.reps !== undefined) data.reps = dto.reps;
    if (dto.is_completed !== undefined) data.is_completed = dto.is_completed;

    const set = await this.prisma.exerciseSet.update({
      where: { id: setId },
      data,
    });

    return {
      id: set.id,
      exercise_id: set.exercise_id,
      set_number: set.set_number,
      weight: set.weight ? Number(set.weight) : null,
      weight_unit: set.weight_unit,
      reps: set.reps,
      is_completed: set.is_completed,
      created_at: set.created_at.toISOString(),
    };
  }

  async deleteSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);
    await this.verifySetOwnership(exerciseId, setId);

    await this.prisma.exerciseSet.delete({ where: { id: setId } });

    return { deleted: true };
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

  // ── Private ──────────────────────────────────────────────

  private async generateProposedSession(userId: string) {
    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    if (!onboarding) return null;

    const allowedEquipment = EQUIPMENT_MAP[onboarding.available_equipment];
    const equipmentFilter =
      allowedEquipment && allowedEquipment.length > 0
        ? { equipment: { in: allowedEquipment } }
        : {};

    const exercises = await this.prisma.exerciseLibrary.findMany({
      where: {
        OR: [{ is_system: true }, { user_id: userId }],
        ...equipmentFilter,
      },
      orderBy: { name: 'asc' },
    });

    if (exercises.length === 0) return null;

    // Pick 4–6 exercises from distinct muscle groups
    const targetCount = Math.min(6, Math.max(4, exercises.length));
    const byMuscle = new Map<string, typeof exercises>();
    for (const ex of exercises) {
      const group = byMuscle.get(ex.muscle_group) ?? [];
      group.push(ex);
      byMuscle.set(ex.muscle_group, group);
    }

    const muscleGroups = [...byMuscle.keys()];
    const picked: typeof exercises = [];
    let mgIndex = 0;

    // Round-robin across muscle groups for variety
    while (picked.length < targetCount && picked.length < exercises.length) {
      const mg = muscleGroups[mgIndex % muscleGroups.length];
      const available = byMuscle.get(mg)!;
      const unused = available.filter((e) => !picked.some((p) => p.id === e.id));
      if (unused.length > 0) {
        // Pick a pseudo-random exercise using date as seed
        const dayOfYear = Math.floor(
          (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
            86400000,
        );
        const idx = (dayOfYear + mgIndex) % unused.length;
        picked.push(unused[idx]);
      }
      mgIndex++;
      // Break if we've gone through all groups without finding new exercises
      if (mgIndex - picked.length > muscleGroups.length) break;
    }

    const setsDisplay =
      SETS_DISPLAY_BY_GOAL[onboarding.primary_goal] ?? '3 × 10';

    const goalLabels: Record<string, string> = {
      build_muscle: 'muscle building',
      lose_fat: 'fat loss',
      get_stronger: 'strength',
      improve_endurance: 'endurance',
      stay_healthy: 'general fitness',
    };
    const goalLabel = goalLabels[onboarding.primary_goal] ?? 'fitness';

    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: "Today's Session",
        type: 'strength',
        status: 'proposed',
        duration_minutes: onboarding.workout_duration,
        ai_generated: true,
        ai_message: `I built a balanced ${goalLabel} session based on your profile and available equipment. Let's go!`,
        updated_at: new Date(),
        exercises: {
          create: picked.map((ex, i) => ({
            library_exercise_id: ex.id,
            name: ex.name,
            muscle_group: ex.muscle_group,
            equipment: ex.equipment,
            step_number: i + 1,
            sets_display: setsDisplay,
            accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
          })),
        },
      },
      include: {
        exercises: { orderBy: { step_number: 'asc' } },
      },
    });

    return session;
  }

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
      })),
    };
  }
}

export { ACCENT_COLORS };
