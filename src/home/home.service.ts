import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CompleteSessionDto, CreateSessionDto } from './dto/home.dto';

const ACCENT_COLORS = ['#E86A75', '#30C08D', '#7A82F6', '#F5A623'];

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [profile, motivation, completedSessions, proposedSession] =
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
      ]);

    const name = profile?.full_name ?? profile?.email?.split('@')[0] ?? '';

    const weekCompletedDays = [
      ...new Set(
        completedSessions
          .filter((s) => s.completed_at !== null)
          .map((s) => (s.completed_at as Date).getDay()),
      ),
    ];

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
      proposed_session: proposedSession
        ? {
            id: proposedSession.id,
            title: proposedSession.title,
            type: proposedSession.type,
            duration_minutes: proposedSession.duration_minutes,
            ai_message: proposedSession.ai_message,
            exercises: proposedSession.exercises.map((e) => ({
              id: e.id,
              name: e.name,
              step_number: e.step_number,
              sets_display: e.sets_display,
              accent_color: e.accent_color,
            })),
          }
        : null,
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

    const updated = await this.prisma.workoutSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completed_at: completedAt,
        duration_minutes: durationMinutes,
        updated_at: new Date(),
      },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });

    return this.formatSession(updated);
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
