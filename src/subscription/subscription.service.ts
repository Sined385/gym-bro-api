import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';

const FREE_COACH_MESSAGE_LIMIT = 20;

const PRODUCT_DURATIONS_DAYS: Record<string, number> = {
  'com.gymjam.monthly.subscription': 35,
  'com.gymgam.threemonth.subscription': 95,
  'com.gymjam.annual.subscription': 370,
};

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  async isPremium(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { is_premium: true, premium_expires_at: true },
    });
    if (!user || !user.is_premium) return false;
    if (user.premium_expires_at && user.premium_expires_at < new Date()) {
      return false;
    }
    return true;
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        is_premium: true,
        premium_source: true,
        premium_granted_at: true,
        premium_expires_at: true,
        storekit_product_id: true,
      },
    });

    const messagesUsed = await this.getUserMessageCount(userId);
    const premium = user?.is_premium ?? false;

    return {
      is_premium: premium,
      premium_source: user?.premium_source ?? null,
      granted_at: user?.premium_granted_at?.toISOString() ?? null,
      expires_at: user?.premium_expires_at?.toISOString() ?? null,
      product_id: user?.storekit_product_id ?? null,
      coach_messages_used: messagesUsed,
      coach_messages_limit: premium ? null : FREE_COACH_MESSAGE_LIMIT,
    };
  }

  async getUserMessageCount(userId: string): Promise<number> {
    return this.prisma.coachMessage.count({
      where: {
        role: 'user',
        conversation: { user_id: userId },
      },
    });
  }

  async checkCoachAccess(userId: string) {
    const premium = await this.isPremium(userId);
    if (premium) {
      return {
        allowed: true,
        messages_used: 0,
        messages_limit: null,
        is_premium: true,
      };
    }

    const messagesUsed = await this.getUserMessageCount(userId);
    const allowed = messagesUsed < FREE_COACH_MESSAGE_LIMIT;

    return {
      allowed,
      messages_used: messagesUsed,
      messages_limit: FREE_COACH_MESSAGE_LIMIT,
      is_premium: false,
    };
  }

  async verifyAndActivate(
    userId: string,
    transactionId: string,
    productId: string,
  ) {
    const durationDays = PRODUCT_DURATIONS_DAYS[productId] ?? 35;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        is_premium: true,
        premium_source: 'storekit',
        premium_granted_at: new Date(),
        premium_expires_at: expiresAt,
        storekit_transaction_id: transactionId,
        storekit_product_id: productId,
      },
    });

    this.analytics.track(userId, 'premium_purchase_verified', {
      product_id: productId,
      transaction_id: transactionId,
    });

    this.analytics.track(userId, 'premium_activated', {
      source: 'storekit',
      product_id: productId,
    });

    return { success: true };
  }

  async grantPremium(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        is_premium: true,
        premium_source: 'admin',
        premium_granted_at: new Date(),
        premium_expires_at: null,
      },
    });

    this.analytics.track(userId, 'premium_activated', {
      source: 'admin',
    });

    return { success: true };
  }

  async revokePremium(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premium_source: true },
    });

    if (user?.premium_source !== 'admin') {
      return {
        success: false,
        reason: 'Can only revoke admin-granted premium',
      };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        is_premium: false,
        premium_source: null,
        premium_granted_at: null,
        premium_expires_at: null,
      },
    });

    this.analytics.track(userId, 'premium_revoked', {
      source: 'admin',
    });

    return { success: true };
  }

  async syncStatus(
    userId: string,
    hasActiveEntitlement: boolean,
    transactionId?: string,
    productId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { is_premium: true, premium_source: true },
    });

    if (hasActiveEntitlement && transactionId && productId) {
      // Renew / extend
      await this.verifyAndActivate(userId, transactionId, productId);
      return { is_premium: true };
    }

    if (!hasActiveEntitlement && user?.premium_source === 'storekit') {
      // Subscription lapsed or cancelled
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          is_premium: false,
          premium_source: null,
          premium_granted_at: null,
          premium_expires_at: null,
          storekit_transaction_id: null,
          storekit_product_id: null,
        },
      });

      this.analytics.track(userId, 'premium_expired', {
        source: 'storekit_sync',
      });

      return { is_premium: false };
    }

    return { is_premium: user?.is_premium ?? false };
  }

  async hasAnyPlan(userId: string): Promise<boolean> {
    const count = await this.prisma.trainingPlan.count({
      where: { user_id: userId },
    });
    return count > 0;
  }
}
