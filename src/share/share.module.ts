import { Module } from '@nestjs/common';
import { HomeModule } from '../home/home.module';
import { CommunityModule } from '../community/community.module';
import { ShareController } from './share.controller';

@Module({
  imports: [HomeModule, CommunityModule],
  controllers: [ShareController],
})
export class ShareModule {}
