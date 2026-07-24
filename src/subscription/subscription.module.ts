import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { AuthModule } from '../auth/auth.module';
import { PremiumGuard } from './premium.guard';
import { PromoService } from './promo.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PremiumGuard, PromoService],
  exports: [SubscriptionService, PremiumGuard, PromoService],
})
export class SubscriptionModule {}
