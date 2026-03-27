import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { OnboardingService } from './onboarding.service';
import type { SaveOnboardingDto } from './dto/onboarding.dto';

@Controller('api/v1/onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  async upsert(@Req() req: Request, @Body() body: SaveOnboardingDto) {
    return this.onboardingService.upsert(req.user!.id, body);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@Req() req: Request) {
    return this.onboardingService.getStatus(req.user!.id);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findOne(@Req() req: Request) {
    return this.onboardingService.findByUserId(req.user!.id);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async patch(@Req() req: Request, @Body() body: Record<string, any>) {
    return this.onboardingService.patchField(req.user!.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req: Request) {
    await this.onboardingService.delete(req.user!.id);
  }
}
