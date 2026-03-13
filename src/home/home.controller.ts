import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HomeService } from './home.service';
import { CompleteSessionDto, CreateSessionDto } from './dto/home.dto';

@Controller('api/v1/home')
@UseGuards(AuthGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  async getDashboard(@Req() req: Request) {
    return this.homeService.getDashboard(req.user!.id);
  }

  @Get('week-calendar')
  @HttpCode(HttpStatus.OK)
  async getWeekCalendar(@Req() req: Request) {
    return this.homeService.getWeekCalendar(req.user!.id);
  }

  @Post('sessions/:id/start')
  @HttpCode(HttpStatus.OK)
  async startSession(@Req() req: Request, @Param('id') sessionId: string) {
    return this.homeService.startSession(req.user!.id, sessionId);
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Req() req: Request, @Body() body: CreateSessionDto) {
    return this.homeService.createSession(req.user!.id, body);
  }

  @Patch('sessions/:id/complete')
  @HttpCode(HttpStatus.OK)
  async completeSession(
    @Req() req: Request,
    @Param('id') sessionId: string,
    @Body() body: CompleteSessionDto,
  ) {
    return this.homeService.completeSession(req.user!.id, sessionId, body);
  }
}
