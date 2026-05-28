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
import { NotificationsService } from '../notifications/notifications.service';
import { MessageActionDto, SendMessageDto } from './dto/coach.dto';

/// Flatten whitespace so streamed markdown/newlines don't blow up the
/// 140-char push body preview.
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

@Controller('api/v1/coach')
@UseGuards(AuthGuard)
export class CoachController {
  constructor(
    private readonly coachService: CoachService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    // Watch for client disconnect (app backgrounded, view closed, etc.). The
    // AI generator keeps running server-side because the for-await loop will
    // continue consuming events even though res.write becomes a no-op; we
    // skip writes once disconnected and fall through to the push notification
    // path below.
    const userId = req.user!.id;
    let clientDisconnected = false;
    let assistantContent = '';
    let assistantMessageId: string | null = null;
    let conversationId: string | null = null;
    let streamErrored = false;

    req.on('close', () => {
      clientDisconnected = true;
    });

    try {
      const stream = this.coachService.chat(userId, dto);
      for await (const event of stream) {
        if (
          event.type === 'text_delta' &&
          typeof (event.data as any)?.content === 'string'
        ) {
          assistantContent += (event.data as any).content;
        }
        if (event.type === 'done') {
          assistantMessageId = (event.data as any)?.message_id ?? null;
          conversationId = (event.data as any)?.conversation_id ?? null;
        }
        if (event.type === 'error') {
          streamErrored = true;
        }
        if (!clientDisconnected) {
          res.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          );
        }
      }
    } catch (error) {
      streamErrored = true;
      console.error('Coach chat stream error:', error);
      if (!clientDisconnected) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: 'Stream failed' })}\n\n`,
        );
      }
    }

    if (!clientDisconnected) {
      res.end();
    }

    // Client gone, AI finished cleanly with content — push so the user sees
    // the reply when they next open the app. iOS handles foreground vs
    // background banner suppression.
    if (
      clientDisconnected &&
      !streamErrored &&
      assistantContent.trim().length > 0 &&
      assistantMessageId
    ) {
      const preview = collapseWhitespace(assistantContent).slice(0, 140);
      await this.notificationsService.sendToUser(userId, {
        type: 'coach_reply',
        title: 'Coach replied',
        body: preview,
        data: {
          conversation_id: conversationId ?? '',
          message_id: assistantMessageId,
        },
      });
    }
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
