import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { HomeService } from '../home/home.service';
import { PlansService } from '../plans/plans.service';
import { SendMessageDto } from './dto/coach.dto';
import { AnalyticsService } from '../analytics/analytics.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { SSEEvent } from './coach-stream.helper';
import { CoachPromptService } from './coach-prompt.service';
import { CoachToolsService } from './coach-tools.service';

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly homeService: HomeService,
    private readonly plansService: PlansService,
    private readonly promptService: CoachPromptService,
    private readonly toolsService: CoachToolsService,
    private readonly analytics: AnalyticsService,
    private readonly aiUsage: AiUsageService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
  ) {}

  async listConversations(userId: string) {
    const conversations = await this.prisma.coachConversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
      include: {
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        last_message: c.messages[0]?.content ?? null,
        created_at: c.created_at.toISOString(),
      })),
    };
  }

  async getOrCreateConversation(userId: string) {
    const existing = await this.prisma.coachConversation.findFirst({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
    });

    if (existing) {
      return { conversation_id: existing.id };
    }

    const conv = await this.prisma.coachConversation.create({
      data: { user_id: userId, updated_at: new Date() },
    });
    return { conversation_id: conv.id };
  }

  async getConversationMessages(
    userId: string,
    conversationId: string,
    pagination: { limit: number; before?: string },
  ) {
    // Verify ownership
    const conversation = await this.prisma.coachConversation.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conversation) {
      return { messages: [], has_more: false };
    }

    const limit = Math.min(pagination.limit || 50, 100);

    const cursor = pagination.before ? { id: pagination.before } : undefined;

    const messages = await this.prisma.coachMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    // Fetch linked sessions for messages that have session_id
    const sessionIds = page
      .filter((m) => m.session_id)
      .map((m) => m.session_id!);

    const sessions =
      sessionIds.length > 0
        ? await this.prisma.workoutSession.findMany({
            where: { id: { in: sessionIds } },
            include: { exercises: { orderBy: { step_number: 'asc' } } },
          })
        : [];

    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    return {
      conversation_id: conversationId,
      has_more: hasMore,
      messages: page.reverse().map((m) => {
        const session = m.session_id ? sessionMap.get(m.session_id) : null;
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at.toISOString(),
          session: session
            ? {
                id: session.id,
                title: session.title,
                type: session.type,
                duration_minutes: session.duration_minutes,
                exercises: session.exercises.map((e) => ({
                  id: e.id,
                  name: e.name,
                  step_number: e.step_number,
                  sets_display: e.sets_display,
                  accent_color: e.accent_color,
                  library_exercise_id: e.library_exercise_id ?? null,
                  muscle_group: e.muscle_group,
                  equipment: e.equipment,
                  suggested_weight: e.suggested_weight ?? null,
                  image_url: exerciseImageUrl(e.external_id),
                  external_id: e.external_id ?? null,
                })),
              }
            : null,
        };
      }),
    };
  }

  async *chat(userId: string, dto: SendMessageDto): AsyncGenerator<SSEEvent> {
    // 1. Find or create conversation
    let conversationId = dto.conversation_id;
    if (!conversationId) {
      const conv = await this.prisma.coachConversation.create({
        data: { user_id: userId, updated_at: new Date() },
      });
      conversationId = conv.id;
    }

    // 2. Save user message
    await this.prisma.coachMessage.create({
      data: {
        conversation_id: conversationId,
        role: 'user',
        content: dto.content,
      },
    });

    await this.prisma.coachConversation.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    this.analytics.track(userId, 'coach_message_sent', {
      conversation_id: conversationId,
    });

    // 3. Build context
    const [
      user,
      onboarding,
      recentSessions,
      weekStats,
      exerciseLibrary,
      history,
      activePlanData,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { full_name: true },
      }),
      this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
      this.promptService.getRecentSessions(userId, 14),
      this.promptService.getWeekStats(userId),
      this.promptService.getExerciseLibrary(userId),
      this.prisma.coachMessage
        .findMany({
          where: { conversation_id: conversationId },
          orderBy: { created_at: 'desc' },
          take: 30,
          select: { role: true, content: true },
        })
        .then((msgs) => msgs.reverse()),
      this.plansService.getActivePlan(userId),
    ]);

    const quickWorkout = await this.prisma.workoutSession.findFirst({
      where: { user_id: userId, status: 'proposed' },
      orderBy: { created_at: 'desc' },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });

    const systemPrompt = this.promptService.buildSystemPrompt(
      user?.full_name ?? null,
      onboarding,
      recentSessions,
      weekStats,
      exerciseLibrary,
      quickWorkout,
      activePlanData,
    );

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(
        (m) =>
          ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }) satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam,
      ),
    ];

    const tools = this.toolsService.getToolDefinitions();
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    // 4. Stream OpenAI response
    const stream = await this.openai.chat.completions.create({
      model,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2000,
      temperature: 0.4,
    });

    let fullContent = '';
    let toolCallId = '';
    let toolCallName = '';
    let toolCallArgs = '';
    let sessionId: string | null = null;
    let streamUsage: {
      prompt_tokens: number;
      completion_tokens: number;
    } | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Text content streaming
      if (delta?.content) {
        fullContent += delta.content;
        yield { type: 'text_delta', data: { content: delta.content } };
      }

      // Tool call accumulation
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) toolCallId = tc.id;
          if (tc.function?.name) toolCallName = tc.function.name;
          if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
        }
      }

      if (chunk.usage) {
        streamUsage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
        };
      }

      // Stream finished — check finish_reason regardless of delta
      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        for await (const event of this.toolsService.handleToolCall({
          toolName: toolCallName,
          toolCallId,
          toolCallArgs,
          userId,
          openai: this.openai,
          model,
          messages,
          fullContent,
          exerciseLibrary,
          userMessage: dto.content,
          onboarding,
          activePlanData,
          tools,
        })) {
          // Capture session ID and follow-up content from internal events
          if ('_sessionId' in event && event._sessionId) {
            sessionId = event._sessionId;
          }
          if ('_followUpContent' in event && event._followUpContent) {
            fullContent += event._followUpContent;
          }
          // Only yield real SSE events to the client
          if (event.type !== '_followup_content') {
            yield { type: event.type, data: event.data };
          }
        }
      }
    }

    if (streamUsage) {
      this.aiUsage.trackUsage({
        userId,
        feature: 'coach_chat',
        model,
        promptTokens: streamUsage.prompt_tokens,
        completionTokens: streamUsage.completion_tokens,
      });
    }

    // 5. Save assistant message (skip empty — prevents polluting history)
    const contentToSave = fullContent.trim();
    const assistantMessage = contentToSave
      ? await this.prisma.coachMessage.create({
          data: {
            conversation_id: conversationId,
            role: 'assistant',
            content: contentToSave,
            session_id: sessionId,
          },
        })
      : await this.prisma.coachMessage.findFirst({
          where: { conversation_id: conversationId },
          orderBy: { created_at: 'desc' },
        });

    yield {
      type: 'done',
      data: {
        message_id: assistantMessage?.id ?? '',
        conversation_id: conversationId,
      },
    };
  }

  async handleAction(
    userId: string,
    messageId: string,
    action: string,
  ): Promise<any> {
    const message = await this.prisma.coachMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });

    if (!message || message.conversation.user_id !== userId) {
      return { error: 'Message not found' };
    }

    if (action === 'start_workout' && message.session_id) {
      const session = await this.homeService.startSession(
        userId,
        message.session_id,
      );
      return { action: 'session_started', session };
    }

    if (action === 'regenerate') {
      return { action: 'regenerate', conversation_id: message.conversation_id };
    }

    return { error: 'Unknown action' };
  }
}
