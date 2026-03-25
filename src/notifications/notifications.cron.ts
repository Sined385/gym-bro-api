import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Workout skip reminder — daily at 10 AM
   * Notifies users who haven't worked out in 3-14 consecutive days.
   */
  @Cron('0 10 * * *')
  async workoutSkipReminder() {
    this.logger.log('Running workout skip reminder cron');

    try {
      // Get all users who have active device tokens
      const activeTokenUsers = await this.prisma.deviceToken.findMany({
        where: { is_active: true },
        select: { user_id: true },
        distinct: ['user_id'],
      });

      const userIds = activeTokenUsers.map((t) => t.user_id);
      if (userIds.length === 0) return;

      const now = new Date();
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      for (const userId of userIds) {
        // Find most recent completed session
        const lastSession = await this.prisma.workoutSession.findFirst({
          where: { user_id: userId, status: 'completed' },
          orderBy: { completed_at: 'desc' },
          select: { completed_at: true },
        });

        if (!lastSession?.completed_at) continue;

        const daysSinceLastWorkout = Math.floor(
          (now.getTime() - lastSession.completed_at.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysSinceLastWorkout >= 3 && daysSinceLastWorkout <= 14) {
          await this.notificationsService.sendToUser(userId, {
            type: 'workout_skip',
            title: 'Miss us?',
            body: `You haven't worked out in ${daysSinceLastWorkout} days. Let's get back on track!`,
          });
        }
      }

      this.logger.log('Workout skip reminder cron completed');
    } catch (error) {
      this.logger.error('Workout skip reminder cron failed', error);
    }
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
        select: { id: true },
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
            await this.notificationsService.sendToUser(user.id, {
              type: 'd2_engagement',
              title: 'Your first workout awaits!',
              body: 'Check out your personalized plan and crush your first session',
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
