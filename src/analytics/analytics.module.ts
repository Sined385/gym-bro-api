import { Global, Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AuthModule } from '../auth/auth.module';
import { AiUsageService } from './ai-usage.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AiUsageService],
  exports: [AnalyticsService, AiUsageService],
})
export class AnalyticsModule {}
