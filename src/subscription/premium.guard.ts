import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { SubscriptionService } from './subscription.service';
import { AppException } from '../common/exceptions/app.exception';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly analytics: AnalyticsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.id;

    if (!userId) {
      throw new AppException(
        'UNAUTHORIZED',
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const premium = await this.subscriptionService.isPremium(userId);
    if (!premium) {
      const handler = context.getHandler();
      const featureName = handler.name ?? 'unknown';

      this.analytics.track(userId, 'paywall_feature_blocked', {
        feature: featureName,
      });

      throw new AppException(
        'PREMIUM_REQUIRED',
        'This feature requires a premium subscription',
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
