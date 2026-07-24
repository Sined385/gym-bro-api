import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { t, type Lang } from '../common/i18n';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PromoRedeemResult =
  | {
      success: true;
      expires_at: string;
      duration_days: number;
      extended: boolean;
    }
  | {
      success: false;
      error_code:
        | 'not_found'
        | 'expired'
        | 'deactivated'
        | 'already_redeemed'
        | 'premium_conflict';
      message: string;
    };

// Failure messages live in the i18n table (promo.* keys) — en values
// are byte-identical to the previous hardcoded strings.
const FAILURE_KEYS: Record<
  Extract<PromoRedeemResult, { success: false }>['error_code'],
  Parameters<typeof t>[1]
> = {
  not_found: 'promo.not_found',
  expired: 'promo.expired',
  deactivated: 'promo.deactivated',
  already_redeemed: 'promo.already_redeemed',
  premium_conflict: 'promo.premium_conflict',
};

/**
 * Promo-code redemption. Codes are multi-use (many users) but once per
 * user per code — enforced by the DB unique (promo_code_id, user_id),
 * so concurrent double-taps can't double-redeem.
 *
 * ALWAYS resolves to HTTP 200 with a success/error envelope: the iOS
 * NetworkService maps 4xx to a bare statusCode without decoding the
 * body, so error semantics must ride in a 200 response.
 */
@Injectable()
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  async redeem(
    userId: string,
    rawCode: string,
    lang: Lang = 'en',
  ): Promise<PromoRedeemResult> {
    const code = rawCode.trim().toUpperCase();
    const now = new Date();

    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo) return this.failure('not_found', lang);
    if (!promo.is_active) return this.failure('deactivated', lang);
    if (promo.expires_at < now) return this.failure('expired', lang);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        is_premium: true,
        premium_source: true,
        premium_expires_at: true,
      },
    });
    if (!user) return this.failure('not_found', lang);

    const premiumActive =
      user.is_premium &&
      (!user.premium_expires_at || user.premium_expires_at > now);

    // StoreKit / admin premium blocks redemption — promo can't stack on
    // a paid or manually-granted subscription.
    if (premiumActive && user.premium_source !== 'promo') {
      return this.failure('premium_conflict', lang);
    }

    // Active promo premium EXTENDS: new expiry stacks the code's
    // duration on top of the current one.
    const extending = premiumActive && user.premium_source === 'promo';
    const base =
      extending && user.premium_expires_at ? user.premium_expires_at : now;
    const newExpiry = new Date(base.getTime() + promo.duration_days * DAY_MS);

    try {
      await this.prisma.$transaction([
        this.prisma.promoRedemption.create({
          data: {
            promo_code_id: promo.id,
            user_id: userId,
            granted_until: newExpiry,
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: {
            is_premium: true,
            premium_source: 'promo',
            premium_granted_at: now,
            premium_expires_at: newExpiry,
          },
        }),
      ]);
    } catch (error: any) {
      // Unique (promo_code_id, user_id) violation — user already
      // redeemed this code (possibly a concurrent double-tap).
      if (error?.code === 'P2002') {
        return this.failure('already_redeemed', lang);
      }
      throw error;
    }

    this.analytics.track(userId, 'promo_redeemed', {
      code,
      promo_code_id: promo.id,
      duration_days: promo.duration_days,
      expires_at: newExpiry.toISOString(),
      extended: extending,
    });
    this.analytics.track(userId, 'premium_activated', {
      source: 'promo',
      code,
    });

    return {
      success: true,
      expires_at: newExpiry.toISOString(),
      duration_days: promo.duration_days,
      extended: extending,
    };
  }

  private failure(
    errorCode: Extract<PromoRedeemResult, { success: false }>['error_code'],
    lang: Lang = 'en',
  ): PromoRedeemResult {
    return {
      success: false,
      error_code: errorCode,
      message: t(lang, FAILURE_KEYS[errorCode]),
    };
  }
}
