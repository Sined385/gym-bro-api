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

  async registerToken(userId: string, token: string, platform: string = 'ios') {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { user_id: userId, platform, is_active: true },
      create: { user_id: userId, token, platform },
    });
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
        data: payload.data ?? {},
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
          this.logger.log(`Deactivated ${tokensToDeactivate.length} invalid FCM tokens`);
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
}
