import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { resolveLang, t, type Lang } from '../common/i18n';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Smart workout skip reminder — runs every hour on the hour.
   * Sends reminders to users at their preferred workout hour (in their local timezone).
   * Falls back to 10 AM UTC for users without timezone/preferred hour data.
   */
  @Cron('0 * * * *')
  async smartWorkoutReminder() {
    this.logger.log('Running smart workout reminder cron');

    try {
      const now = new Date();
      const currentUtcHour = now.getUTCHours();

      // Get all users who have active device tokens
      const activeTokenUsers = await this.prisma.deviceToken.findMany({
        where: { is_active: true },
        select: { user_id: true },
        distinct: ['user_id'],
      });

      const userIds = activeTokenUsers.map((t) => t.user_id);
      if (userIds.length === 0) return;

      // Fetch users with their timezone and preferred hour
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          timezone: true,
          preferred_workout_hour: true,
          language: true,
        },
      });

      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);

      for (const user of users) {
        const shouldSend = this.shouldSendReminder(user, currentUtcHour, now);

        if (!shouldSend) continue;

        // Check last completed session is 3-14 days ago
        const lastSession = await this.prisma.workoutSession.findFirst({
          where: { user_id: user.id, status: 'completed' },
          orderBy: { completed_at: 'desc' },
          select: { completed_at: true },
        });

        if (!lastSession?.completed_at) continue;

        const daysSinceLastWorkout = Math.floor(
          (now.getTime() - lastSession.completed_at.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (daysSinceLastWorkout < 3 || daysSinceLastWorkout > 14) continue;

        // Dedup: don't send if we already sent a workout_skip today
        const alreadySentToday = await this.prisma.notification.findFirst({
          where: {
            user_id: user.id,
            type: 'workout_skip',
            created_at: { gte: todayStart },
          },
        });

        if (alreadySentToday) continue;

        const message = this.getWorkoutSkipMessage(
          daysSinceLastWorkout,
          resolveLang(undefined, user.language),
        );
        await this.notificationsService.sendToUser(user.id, {
          type: 'workout_skip',
          title: message.title,
          body: message.body,
        });
      }

      this.logger.log('Smart workout reminder cron completed');
    } catch (error) {
      this.logger.error('Smart workout reminder cron failed', error);
    }
  }

  private getWorkoutSkipMessage(
    days: number,
    lang: Lang = 'en',
  ): {
    title: string;
    body: string;
  } {
    const messages = [
      {
        title: t(lang, 'push.skip1_title'),
        body: t(lang, 'push.skip1_body', { days }),
      },
      {
        title: t(lang, 'push.skip2_title'),
        body: t(lang, 'push.skip2_body', { days }),
      },
      {
        title: t(lang, 'push.skip3_title'),
        body: t(lang, 'push.skip3_body', { days }),
      },
      {
        title: t(lang, 'push.skip4_title'),
        body: t(lang, 'push.skip4_body', { days }),
      },
      {
        title: t(lang, 'push.skip5_title'),
        body: t(lang, 'push.skip5_body', { days }),
      },
    ];

    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Determine whether to send the reminder to this user right now.
   * - Users with timezone + preferred_workout_hour: send when their local hour matches.
   * - Users without: fall back to 10 AM UTC.
   */
  private shouldSendReminder(
    user: { timezone: string | null; preferred_workout_hour: number | null },
    currentUtcHour: number,
    now: Date,
  ): boolean {
    if (user.timezone && user.preferred_workout_hour !== null) {
      const localHour = this.getLocalHour(now, user.timezone);
      return localHour === user.preferred_workout_hour;
    }

    // Fallback: send at 10 AM UTC
    return currentUtcHour === 10;
  }

  /**
   * Get the current local hour for a given IANA timezone.
   * Uses Intl.DateTimeFormat which handles DST automatically.
   */
  private getLocalHour(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    return parseInt(hourPart!.value, 10);
  }

  /**
   * D2 engagement — daily at noon
   * Targets users who signed up 24-48 hours ago and haven't completed any workout.
   */
  @Cron('0 12 * * *')
  async d2Engagement() {
    this.logger.log('Running D2 engagement cron');

    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now);
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 48);
      const fortyEightHoursAgo = new Date(now);
      fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

      // Users who signed up between 24-48 hours ago
      const recentUsers = await this.prisma.user.findMany({
        where: {
          created_at: {
            gte: fortyEightHoursAgo,
            lte: twentyFourHoursAgo,
          },
        },
        select: { id: true, language: true },
      });

      for (const user of recentUsers) {
        // Check if they have any completed sessions
        const completedCount = await this.prisma.workoutSession.count({
          where: { user_id: user.id, status: 'completed' },
        });

        if (completedCount === 0) {
          // Check if they have a device token (no point sending if no token)
          const hasToken = await this.prisma.deviceToken.findFirst({
            where: { user_id: user.id, is_active: true },
          });

          if (hasToken) {
            const lang = resolveLang(undefined, user.language);
            await this.notificationsService.sendToUser(user.id, {
              type: 'd2_engagement',
              title: t(lang, 'push.d2_title'),
              body: t(lang, 'push.d2_body'),
            });
          }
        }
      }

      this.logger.log('D2 engagement cron completed');
    } catch (error) {
      this.logger.error('D2 engagement cron failed', error);
    }
  }
}
