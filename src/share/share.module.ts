import { Module } from '@nestjs/common';
import { HomeModule } from '../home/home.module';
import { ShareController } from './share.controller';

@Module({
  imports: [HomeModule],
  controllers: [ShareController],
})
export class ShareModule {}
