import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { HomeAiService } from './home-ai.service';
import { SessionExerciseService } from './session-exercise.service';
import { TemplateService } from './template.service';
import { WeightSuggestionService } from './weight-suggestion.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [HomeController],
  providers: [
    HomeService,
    HomeAiService,
    SessionExerciseService,
    TemplateService,
    WeightSuggestionService,
  ],
  exports: [HomeService, WeightSuggestionService, TemplateService],
})
export class HomeModule {}
