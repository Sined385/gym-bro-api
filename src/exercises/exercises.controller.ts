import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PremiumGuard } from '../subscription/premium.guard';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/exercises.dto';

@Controller('api/v1/exercises')
@UseGuards(AuthGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listExercises(
    @Query('search') search?: string,
    @Query('muscle_group') muscleGroup?: string,
    @Req() req?: Request,
  ) {
    return this.exercisesService.listExercises(
      req!.user!.id,
      search,
      muscleGroup,
    );
  }

  @Post()
  @UseGuards(PremiumGuard)
  @HttpCode(HttpStatus.CREATED)
  async createExercise(@Body() dto: CreateExerciseDto, @Req() req: Request) {
    return this.exercisesService.createExercise(req.user!.id, dto);
  }

  // MUST stay above the ':id' routes — otherwise 'translations' would
  // be swallowed as an exercise id.
  @Get('translations')
  @HttpCode(HttpStatus.OK)
  // The map only changes on catalog re-seeds; an hour of client/proxy
  // caching keeps the ~750-entry payload off the hot path.
  @Header('Cache-Control', 'public, max-age=3600')
  async getTranslations(@Query('lang') lang?: string) {
    return this.exercisesService.getTranslations(lang ?? 'uk');
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getExercise(@Param('id') exerciseId: string, @Req() req: Request) {
    return this.exercisesService.getExercise(req.user!.id, exerciseId);
  }

  @Get(':id/previous-sets')
  @HttpCode(HttpStatus.OK)
  async getPreviousSets(@Param('id') exerciseId: string, @Req() req: Request) {
    return this.exercisesService.getPreviousSets(req.user!.id, exerciseId);
  }

  @Post(':id/favorite')
  @HttpCode(HttpStatus.OK)
  async favoriteExercise(@Param('id') exerciseId: string, @Req() req: Request) {
    return this.exercisesService.favoriteExercise(req.user!.id, exerciseId);
  }

  @Delete(':id/favorite')
  @HttpCode(HttpStatus.OK)
  async unfavoriteExercise(
    @Param('id') exerciseId: string,
    @Req() req: Request,
  ) {
    return this.exercisesService.unfavoriteExercise(req.user!.id, exerciseId);
  }
}
