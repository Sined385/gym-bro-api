import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WeightSuggestionModule } from '../weight-suggestion/weight-suggestion.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansAiService } from './plans-ai.service';
import { PlanGeneratorService } from './plan-generator.service';
import { PlanAdapterService } from './plan-adapter.service';

@Module({
  imports: [AuthModule, WeightSuggestionModule],
  controllers: [PlansController],
  providers: [
    PlansService,
    PlansAiService,
    PlanGeneratorService,
    PlanAdapterService,
  ],
  exports: [PlansService, PlanGeneratorService],
})
export class PlansModule {}
