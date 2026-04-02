import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PlansService } from './plans.service';
import { GeneratePlanDto } from './dto/plans.dto';

@Controller('api/v1/plans')
@UseGuards(AuthGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async getActivePlan(@Req() req: Request) {
    return this.plansService.getActivePlan(req.user!.id);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  async generatePlan(@Req() req: Request, @Body() dto: GeneratePlanDto) {
    return this.plansService.generatePlan(req.user!.id, dto.force ?? false);
  }

  @Post('days/:dayId/start')
  @HttpCode(HttpStatus.OK)
  async startPlanSession(@Req() req: Request, @Param('dayId') dayId: string) {
    return this.plansService.startPlanSession(req.user!.id, dayId);
  }
}
