import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto } from './dto/track-event.dto';
import { Request } from 'express';

@Controller('api/v1/analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('events')
  async trackEvent(@Req() req: Request, @Body() dto: TrackEventDto) {
    await this.analytics.track(
      req.user!.id,
      dto.event_name,
      dto.properties ?? {},
    );
    return { success: true };
  }
}
