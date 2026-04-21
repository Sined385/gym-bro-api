import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';
import {
  RegisterTokenDto,
  RemoveTokenDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';
import { Request } from 'express';

@Controller('api/v1/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('device-token')
  async registerToken(@Body() dto: RegisterTokenDto, @Req() req: Request) {
    const userId = req.user!.id;
    await this.notificationsService.registerToken(
      userId,
      dto.token,
      dto.platform ?? 'ios',
      dto.timezone,
    );
    return { success: true };
  }

  @Delete('device-token')
  async removeToken(@Body() dto: RemoveTokenDto) {
    await this.notificationsService.removeToken(dto.token);
    return { success: true };
  }

  @Get()
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
    @Req() req: Request,
  ) {
    const userId = req.user!.id;
    return this.notificationsService.getNotifications(
      userId,
      query.cursor,
      query.limit,
    );
  }

  @Get('unread-count')
  async unreadCount(@Req() req: Request) {
    const userId = req.user!.id;
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user!.id;
    return this.notificationsService.markAsRead(userId, id);
  }

  @Patch('read-all')
  async markAllRead(@Req() req: Request) {
    const userId = req.user!.id;
    return this.notificationsService.markAllAsRead(userId);
  }
}
