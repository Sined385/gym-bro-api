import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SharedCardsService } from './share-cards.service';
import { CreateSharedCardDto } from './dto/shared-card.dto';

@Controller('api/v1/share-cards')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
export class ShareCardsController {
  constructor(private readonly sharedCardsService: SharedCardsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSharedCard(@Body() dto: CreateSharedCardDto, @Req() req: Request) {
    return this.sharedCardsService.createSharedCard(req.user!.id, dto);
  }
}
