import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CoachService } from './coach.service';
import { MessageActionDto, SendMessageDto } from './dto/coach.dto';

@Controller('api/v1/coach')
@UseGuards(AuthGuard)
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Get('conversations')
  @HttpCode(HttpStatus.OK)
  async listConversations(@Req() req: Request) {
    return this.coachService.listConversations(req.user!.id);
  }

  @Get('conversations/current')
  @HttpCode(HttpStatus.OK)
  async getOrCreateConversation(@Req() req: Request) {
    return this.coachService.getOrCreateConversation(req.user!.id);
  }

  @Get('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async getConversationMessages(
    @Req() req: Request,
    @Param('id') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.coachService.getConversationMessages(
      req.user!.id,
      conversationId,
      {
        limit: limit ? parseInt(limit, 10) : 50,
        before,
      },
    );
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async chat(
    @Req() req: Request,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.coachService.chat(req.user!.id, dto);
      for await (const event of stream) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      console.error('Coach chat stream error:', error);
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: 'Stream failed' })}\n\n`,
      );
    }

    res.end();
  }

  @Post('chat/:messageId/action')
  @HttpCode(HttpStatus.OK)
  async handleAction(
    @Req() req: Request,
    @Param('messageId') messageId: string,
    @Body() dto: MessageActionDto,
  ) {
    return this.coachService.handleAction(req.user!.id, messageId, dto.action);
  }
}
