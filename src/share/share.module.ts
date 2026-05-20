import { Module } from '@nestjs/common';
import { HomeModule } from '../home/home.module';
import { CommunityModule } from '../community/community.module';
import { ShareController } from './share.controller';
import { ShareCardsController } from './share-cards.controller';
import { SharedCardsService } from './share-cards.service';

@Module({
  imports: [HomeModule, CommunityModule],
  controllers: [ShareController, ShareCardsController],
  providers: [SharedCardsService],
  exports: [SharedCardsService],
})
export class ShareModule {}
