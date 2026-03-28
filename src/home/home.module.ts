import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { HomeAiService } from './home-ai.service';
import { SessionExerciseService } from './session-exercise.service';
import { WeightSuggestionService } from './weight-suggestion.service';

@Module({
  imports: [AuthModule],
  controllers: [HomeController],
  providers: [HomeService, HomeAiService, SessionExerciseService, WeightSuggestionService],
  exports: [HomeService, WeightSuggestionService],
})
export class HomeModule {}
