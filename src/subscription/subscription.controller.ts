import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SubscriptionService } from './subscription.service';
import {
  VerifySubscriptionDto,
  SyncSubscriptionDto,
} from './dto/subscription.dto';

@Controller('api/v1/subscription')
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@Req() req: Request) {
    return this.subscriptionService.getStatus(req.user!.id);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Req() req: Request, @Body() dto: VerifySubscriptionDto) {
    return this.subscriptionService.verifyAndActivate(
      req.user!.id,
      dto.transaction_id,
      dto.product_id,
    );
  }

  @Post('restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Req() req: Request, @Body() dto: VerifySubscriptionDto) {
    return this.subscriptionService.verifyAndActivate(
      req.user!.id,
      dto.transaction_id,
      dto.product_id,
    );
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(@Req() req: Request, @Body() dto: SyncSubscriptionDto) {
    return this.subscriptionService.syncStatus(
      req.user!.id,
      dto.has_active_entitlement,
      dto.transaction_id,
      dto.product_id,
    );
  }
}
