import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { AuthModule } from '../auth/auth.module';
import { PremiumGuard } from './premium.guard';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PremiumGuard],
  exports: [SubscriptionService, PremiumGuard],
})
export class SubscriptionModule {}
