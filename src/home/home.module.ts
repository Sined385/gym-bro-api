import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlansModule } from '../plans/plans.module';
import { WeightSuggestionModule } from '../weight-suggestion/weight-suggestion.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { HomeAiService } from './home-ai.service';
import { SessionExerciseService } from './session-exercise.service';
import { TemplateService } from './template.service';
import { ChallengesService } from './challenges.service';

@Module({
  imports: [AuthModule, NotificationsModule, PlansModule, WeightSuggestionModule],
  controllers: [HomeController],
  providers: [
    HomeService,
    HomeAiService,
    SessionExerciseService,
    TemplateService,
    ChallengesService,
  ],
  exports: [HomeService, TemplateService],
})
export class HomeModule {}
