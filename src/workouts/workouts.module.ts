import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlansModule } from '../plans/plans.module';
import { WorkoutOrchestratorService } from './workout-orchestrator.service';
import { PlanRolloverCronService } from './plan-rollover.cron';

// Global so HomeModule and CoachModule don't need to import this — that
// would re-form the existing PlansModule → HomeModule cycle (PlansModule
// pulls HomeModule for WeightSuggestionService). PrismaModule and
// AnalyticsModule are also @Global() in this codebase; the orchestrator
// pattern fits.
@Global()
@Module({
  imports: [NotificationsModule, PlansModule],
  providers: [WorkoutOrchestratorService, PlanRolloverCronService],
  exports: [WorkoutOrchestratorService],
})
export class WorkoutsModule {}
