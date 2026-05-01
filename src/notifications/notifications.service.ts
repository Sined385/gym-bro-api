import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';

export interface SendNotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Device Tokens ────────────────────────────────────────

  async registerToken(
    userId: string,
    token: string,
    platform: string = 'ios',
    timezone?: string,
  ) {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { user_id: userId, platform, is_active: true },
      create: { user_id: userId, token, platform },
    });

    if (timezone) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { timezone },
      });
    }
  }

  async removeToken(token: string) {
    await this.prisma.deviceToken.updateMany({
      where: { token },
      data: { is_active: false },
    });
  }

  // ── Send Notification ────────────────────────────────────

  async sendToUser(userId: string, payload: SendNotificationPayload) {
    try {
      // Save to DB
      await this.prisma.notification.create({
        data: {
          user_id: userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? undefined,
        },
      });

      // Get active device tokens
      const tokens = await this.prisma.deviceToken.findMany({
        where: { user_id: userId, is_active: true },
      });

      if (tokens.length === 0) return;

      const fcmTokens = tokens.map((t) => t.token);

      // Send FCM push
      const message: admin.messaging.MulticastMessage = {
        tokens: fcmTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: { ...(payload.data ?? {}), type: payload.type },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: await this.getUnreadCount(userId),
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Deactivate tokens that failed with "unregistered"
      if (response.failureCount > 0) {
        const tokensToDeactivate: string[] = [];
        response.responses.forEach((res, idx) => {
          if (
            res.error &&
            (res.error.code === 'messaging/registration-token-not-registered' ||
              res.error.code === 'messaging/invalid-registration-token')
          ) {
            tokensToDeactivate.push(fcmTokens[idx]);
          }
        });

        if (tokensToDeactivate.length > 0) {
          await this.prisma.deviceToken.updateMany({
            where: { token: { in: tokensToDeactivate } },
            data: { is_active: false },
          });
          this.logger.log(
            `Deactivated ${tokensToDeactivate.length} invalid FCM tokens`,
          );
        }
      }
    } catch (error) {
      // Fire-and-forget: never throw from notification sends
      this.logger.error('Failed to send notification', error);
    }
  }

  // ── Query ───────────────────────────────────────────────

  async getNotifications(userId: string, cursor?: string, limit: number = 20) {
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const notifications = await this.prisma.notification.findMany({
      where: {
        user_id: userId,
        ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = notifications.length > limit;
    const result = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore
      ? result[result.length - 1].created_at.toISOString()
      : null;

    return {
      notifications: result.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        isRead: n.is_read,
        createdAt: n.created_at.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, user_id: userId },
      data: { is_read: true },
    });
    return { success: true };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    return { success: true };
  }

  // ── Preferred Workout Hour ────────────────────────────────

  async recalculatePreferredHour(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });

      if (!user?.timezone) return;

      const sessions = await this.prisma.workoutSession.findMany({
        where: {
          user_id: userId,
          status: 'completed',
          started_at: { not: null },
        },
        orderBy: { started_at: 'desc' },
        take: 10,
        select: { started_at: true },
      });

      if (sessions.length < 3) return;

      // Convert each started_at to the user's local hour
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: user.timezone,
        hour: 'numeric',
        hour12: false,
      });

      const hours = sessions.map((s) => {
        const parts = formatter.formatToParts(s.started_at!);
        const hourPart = parts.find((p) => p.type === 'hour');
        return parseInt(hourPart!.value, 10);
      });

      // Compute mode (most frequent hour). On tie, pick the hour from the most recent session.
      const freq = new Map<number, number>();
      for (const h of hours) {
        freq.set(h, (freq.get(h) ?? 0) + 1);
      }

      let maxCount = 0;
      for (const count of freq.values()) {
        if (count > maxCount) maxCount = count;
      }

      // Among hours with maxCount, pick the one that appears first (most recent)
      const preferredHour = hours.find((h) => freq.get(h) === maxCount)!;

      await this.prisma.user.update({
        where: { id: userId },
        data: { preferred_workout_hour: preferredHour },
      });
    } catch (error) {
      this.logger.error('Failed to recalculate preferred hour', error);
    }
  }
}
