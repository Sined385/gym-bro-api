import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async track(
    userId: string,
    eventName: string,
    properties: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          user_id: userId,
          event_name: eventName,
          properties,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to track event '${eventName}': ${error}`);
    }
  }
}
