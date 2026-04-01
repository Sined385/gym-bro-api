import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HomeModule } from '../home/home.module';
import { PlansModule } from '../plans/plans.module';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';

@Module({
  imports: [AuthModule, HomeModule, PlansModule],
  controllers: [CoachController],
  providers: [CoachService],
})
export class CoachModule {}
