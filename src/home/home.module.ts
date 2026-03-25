import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { HomeAiService } from './home-ai.service';
import { SessionExerciseService } from './session-exercise.service';

@Module({
  imports: [AuthModule],
  controllers: [HomeController],
  providers: [HomeService, HomeAiService, SessionExerciseService],
  exports: [HomeService],
})
export class HomeModule {}
