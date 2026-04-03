import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityAiService } from './community-ai.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityAiService],
  exports: [CommunityService],
})
export class CommunityModule {}
