import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutOrchestratorService } from './workout-orchestrator.service';

/**
 * Proactive weekly plan rollover.
 *
 * Without this, the rollover happens lazily inside the first
 * /home/dashboard or /plans request of the new week — which used to
 * mean a 10-20s cold start every Monday morning. The lazy path still
 * exists (now non-blocking) as a fallback; this cron just makes sure
 * it almost never fires for active users.
 *
 * Token-spend guard rails:
 *  - Only users ACTIVE in the last 14 days are pre-rolled (completed
 *    a session or produced an analytics event). Churned users keep
 *    the lazy path — no tokens burned on people who never come back.
 *  - Free-tier rollovers use the deterministic template (zero OpenAI
 *    calls) via ensureCurrentWeek's premium check, same as always.
 *  - Users are rolled sequentially (awaitGeneration) so a Monday
 *    backlog doesn't stampede OpenAI.
 */
@Injectable()
export class PlanRolloverCronService {
  private readonly logger = new Logger(PlanRolloverCronService.name);

  private static readonly ACTIVITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: WorkoutOrchestratorService,
  ) {}

  // Hourly at :20 (offset from the notifications cron at :00). Hourly
  // rather than weekly so each user rolls over shortly after THEIR
  // timezone's week ends, and a missed run self-heals an hour later.
  @Cron('20 * * * *')
  async rollStaleWeeklyPlans() {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const stalePlans = await this.prisma.trainingPlan.findMany({
      where: { is_active: true, week_start_date: { lte: weekAgo } },
      select: { user_id: true },
    });
    if (stalePlans.length === 0) return;
    const staleUserIds = [...new Set(stalePlans.map((p) => p.user_id))];

    const activityCutoff = new Date(
      now - PlanRolloverCronService.ACTIVITY_WINDOW_MS,
    );
    const [recentSessions, recentEvents] = await Promise.all([
      this.prisma.workoutSession.findMany({
        where: {
          user_id: { in: staleUserIds },
          status: 'completed',
          completed_at: { gte: activityCutoff },
        },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          user_id: { in: staleUserIds },
          created_at: { gte: activityCutoff },
        },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
    ]);
    const activeUserIds = new Set([
      ...recentSessions.map((s) => s.user_id),
      ...recentEvents.map((e) => e.user_id),
    ]);

    const toRoll = staleUserIds.filter((id) => activeUserIds.has(id));
    this.logger.log(
      `Weekly rollover: ${toRoll.length} active user(s) to roll, ` +
        `${staleUserIds.length - toRoll.length} inactive skipped (lazy path)`,
    );

    for (const userId of toRoll) {
      try {
        await this.orchestrator.ensureCurrentWeek(userId, {
          awaitGeneration: true,
        });
      } catch (error) {
        this.logger.warn(
          `Rollover failed for user ${userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
