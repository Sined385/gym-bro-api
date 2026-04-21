import {
  Body,
  Controller,
  Get,
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
}
