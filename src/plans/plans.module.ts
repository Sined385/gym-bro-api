import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HomeModule } from '../home/home.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansAiService } from './plans-ai.service';

@Module({
  imports: [AuthModule, HomeModule],
  controllers: [PlansController],
  providers: [PlansService, PlansAiService],
  exports: [PlansService],
})
export class PlansModule {}
