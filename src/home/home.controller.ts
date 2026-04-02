import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HomeService } from './home.service';
import { SessionExerciseService } from './session-exercise.service';
import { TemplateService } from './template.service';
import {
  AddExercisesDto,
  CompleteSessionDto,
  CreateSessionDto,
  CreateSupersetDto,
  FeedbackDto,
  GetCompletedDaysDto,
  GetSessionHistoryDto,
  LogSetDto,
  UpdateSetDto,
} from './dto/home.dto';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

@Controller('api/v1/home')
@UseGuards(AuthGuard)
export class HomeController {
  constructor(
    private readonly homeService: HomeService,
    private readonly sessionExerciseService: SessionExerciseService,
    private readonly templateService: TemplateService,
  ) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async getDashboard(@Req() req: Request) {
    return this.homeService.getDashboard(req.user!.id);
  }

  @Get('week-calendar')
  @HttpCode(HttpStatus.OK)
  async getWeekCalendar(@Req() req: Request) {
    return this.homeService.getWeekCalendar(req.user!.id);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getSessionHistory(
    @Query() query: GetSessionHistoryDto,
    @Req() req: Request,
  ) {
    return this.homeService.getSessionHistory(req.user!.id, query.date);
  }

  @Get('completed-days')
  @HttpCode(HttpStatus.OK)
  async getCompletedDays(
    @Query() query: GetCompletedDaysDto,
    @Req() req: Request,
  ) {
    return this.homeService.getCompletedDays(req.user!.id, query.month);
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

  @Post('sessions/:id/exercises')
  @HttpCode(HttpStatus.CREATED)
  async addExercises(
    @Param('id') sessionId: string,
    @Body() dto: AddExercisesDto,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.addExercises(
      req.user!.id,
      sessionId,
      dto,
    );
  }

  @Post('sessions/:id/supersets')
  @HttpCode(HttpStatus.OK)
  async createSuperset(
    @Param('id') sessionId: string,
    @Body() dto: CreateSupersetDto,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.createSuperset(
      req.user!.id,
      sessionId,
      dto,
    );
  }

  @Delete('sessions/:id/exercises/:eid')
  @HttpCode(HttpStatus.OK)
  async removeExercise(
    @Param('id') sessionId: string,
    @Param('eid') exerciseId: string,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.removeExercise(
      req.user!.id,
      sessionId,
      exerciseId,
    );
  }

  @Post('sessions/:id/exercises/:eid/sets')
  @HttpCode(HttpStatus.CREATED)
  async logSet(
    @Param('id') sessionId: string,
    @Param('eid') exerciseId: string,
    @Body() dto: LogSetDto,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.logSet(
      req.user!.id,
      sessionId,
      exerciseId,
      dto,
    );
  }

  @Patch('sessions/:id/exercises/:eid/sets/:sid')
  @HttpCode(HttpStatus.OK)
  async updateSet(
    @Param('id') sessionId: string,
    @Param('eid') exerciseId: string,
    @Param('sid') setId: string,
    @Body() dto: UpdateSetDto,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.updateSet(
      req.user!.id,
      sessionId,
      exerciseId,
      setId,
      dto,
    );
  }

  @Delete('sessions/:id/exercises/:eid/sets/:sid')
  @HttpCode(HttpStatus.OK)
  async deleteSet(
    @Param('id') sessionId: string,
    @Param('eid') exerciseId: string,
    @Param('sid') setId: string,
    @Req() req: Request,
  ) {
    return this.sessionExerciseService.deleteSet(
      req.user!.id,
      sessionId,
      exerciseId,
      setId,
    );
  }

  @Post('sessions/:id/feedback')
  @HttpCode(HttpStatus.CREATED)
  async submitFeedback(
    @Param('id') sessionId: string,
    @Body() dto: FeedbackDto,
    @Req() req: Request,
  ) {
    return this.homeService.submitFeedback(req.user!.id, sessionId, dto);
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

  // ── Templates ──────────────────────────────────────────

  @Get('templates')
  @HttpCode(HttpStatus.OK)
  async listTemplates(@Req() req: Request) {
    return this.templateService.listTemplates(req.user!.id);
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(@Req() req: Request, @Body() dto: CreateTemplateDto) {
    return this.templateService.createTemplate(req.user!.id, dto);
  }

  @Patch('templates/:id')
  @HttpCode(HttpStatus.OK)
  async updateTemplate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateService.updateTemplate(req.user!.id, id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.OK)
  async deleteTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.templateService.deleteTemplate(req.user!.id, id);
  }

  @Post('templates/:id/start')
  @HttpCode(HttpStatus.OK)
  async startFromTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.templateService.startFromTemplate(req.user!.id, id);
  }

  @Post('templates/:id/share')
  @HttpCode(HttpStatus.OK)
  async shareTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.templateService.shareTemplate(req.user!.id, id);
  }

  @Post('templates/save-shared/:code')
  @HttpCode(HttpStatus.CREATED)
  async saveSharedTemplate(
    @Req() req: Request,
    @Param('code') code: string,
  ) {
    return this.templateService.saveSharedTemplate(req.user!.id, code);
  }
}
