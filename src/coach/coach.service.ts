import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { HomeService } from '../home/home.service';
import { PlansService } from '../plans/plans.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { SendMessageDto } from './dto/coach.dto';
import { AnalyticsService } from '../analytics/analytics.service';

interface SSEEvent {
  type: string;
  data: Record<string, any>;
}

/**
 * Attempt to repair and parse potentially truncated/trailing JSON from streamed OpenAI tool calls.
 */
function safeParseToolArgs(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    console.warn('[safeParseToolArgs] Raw tool args failed to parse, attempting repair. Raw:', raw);

    // Strategy 1: trailing garbage after valid JSON — find the closing brace
    const firstBrace = raw.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = firstBrace; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(firstBrace, i + 1));
          } catch { break; }
        }
      }
    }

    // Strategy 2: truncated JSON — close open strings, arrays, objects
    let repaired = raw.trim();
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';
    const balance = (o: string, c: string) => {
      const opens = (repaired.match(new RegExp(`\\${o}`, 'g')) || []).length;
      const closes = (repaired.match(new RegExp(`\\${c}`, 'g')) || []).length;
      for (let i = 0; i < opens - closes; i++) repaired += c;
    };
    balance('[', ']');
    balance('{', '}');
    repaired = repaired.replace(/,\s*([\]}])/g, '$1');

    try {
      return JSON.parse(repaired);
    } catch (repairErr) {
      console.error('[safeParseToolArgs] Repair also failed. Repaired:', repaired);
      throw firstErr;
    }
  }
}

const EQUIPMENT_MAP: Record<string, string[]> = {
  full_gym: [],
  dumbbells_only: ['Dumbbells', 'Bodyweight'],
  bodyweight: ['Bodyweight'],
  home_gym: ['Dumbbells', 'Bodyweight', 'Bands'],
};

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly homeService: HomeService,
    private readonly plansService: PlansService,
    private readonly analytics: AnalyticsService,
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

    const cursor = pagination.before
      ? { id: pagination.before }
      : undefined;

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
    const [user, onboarding, recentSessions, weekStats, exerciseLibrary, history, activePlanData] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { full_name: true } }),
        this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
        this.getRecentSessions(userId, 14),
        this.getWeekStats(userId),
        this.getExerciseLibrary(userId),
        this.prisma.coachMessage.findMany({
          where: { conversation_id: conversationId },
          orderBy: { created_at: 'asc' },
          take: 20,
          select: { role: true, content: true },
        }),
        this.plansService.getActivePlan(userId),
      ]);

    const quickWorkout = await this.prisma.workoutSession.findFirst({
      where: { user_id: userId, status: 'proposed' },
      orderBy: { created_at: 'desc' },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });

    const systemPrompt = this.buildSystemPrompt(
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

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'create_workout_session',
          description:
            'Create a new workout session for the user based on their request. Use this when the user asks you to create, build, or generate a workout.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Session title' },
              type: {
                type: 'string',
                enum: ['strength', 'cardio', 'mobility', 'hiit', 'custom'],
              },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    library_exercise_id: { type: 'string' },
                    name: { type: 'string' },
                    muscle_group: { type: 'string' },
                    sets_display: {
                      type: 'string',
                      description:
                        'Sets and reps in "N × M" format, e.g. "3 × 10", "4 × 8". Always use the × character.',
                    },
                  },
                  required: ['name', 'muscle_group', 'sets_display'],
                },
              },
              ai_message: {
                type: 'string',
                description: 'Short explanation of why you chose this workout',
              },
            },
            required: ['title', 'type', 'exercises', 'ai_message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'modify_plan_days',
          description:
            'Modify one or more days in the user\'s weekly training plan. Use this when the user asks to change, swap, or adjust days in their plan — supports single day or bulk changes.',
          parameters: {
            type: 'object',
            properties: {
              days: {
                type: 'array',
                description: 'Array of days to modify',
                items: {
                  type: 'object',
                  properties: {
                    day_of_week: {
                      type: 'number',
                      description: 'Day of week to modify: 0=Monday, 1=Tuesday, ..., 6=Sunday',
                    },
                    day_type: {
                      type: 'string',
                      enum: ['training', 'rest'],
                      description: 'Whether this should be a training or rest day',
                    },
                    session_title: {
                      type: 'string',
                      description: 'New session title (for training days)',
                    },
                    session_type: {
                      type: 'string',
                      enum: ['strength', 'cardio', 'mobility', 'hiit', 'custom'],
                    },
                    muscle_groups: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Target muscle groups',
                    },
                    exercises: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          library_exercise_id: { type: 'string' },
                          name: { type: 'string' },
                          muscle_group: { type: 'string' },
                          sets_display: { type: 'string' },
                        },
                        required: ['name', 'muscle_group', 'sets_display'],
                      },
                    },
                  },
                  required: ['day_of_week', 'day_type'],
                },
              },
            },
            required: ['days'],
          },
        },
      },
    ];

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    // 4. Stream OpenAI response
    const stream = await this.openai.chat.completions.create({
      model,
      messages,
      tools,
      stream: true,
      max_tokens: 2000,
      temperature: 0.4,
    });

    let fullContent = '';
    let toolCallId = '';
    let toolCallName = '';
    let toolCallArgs = '';
    let sessionId: string | null = null;

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

      // Stream finished — check finish_reason regardless of delta
      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        // Execute the tool
        if (toolCallName === 'create_workout_session') {
          try {
            const args = safeParseToolArgs(toolCallArgs) as any;
            const session = await this.createWorkoutSession(
              userId,
              args,
              exerciseLibrary,
            );
            sessionId = session.id;

            yield {
              type: 'session_created',
              data: {
                session: {
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
                  })),
                },
              },
            };

            // Feed tool result back and get final message
            const followUp = await this.openai.chat.completions.create({
              model,
              messages: [
                ...messages,
                {
                  role: 'assistant',
                  content: fullContent || null,
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      function: {
                        name: toolCallName,
                        arguments: toolCallArgs,
                      },
                    },
                  ],
                },
                {
                  role: 'tool',
                  tool_call_id: toolCallId,
                  content: JSON.stringify({
                    success: true,
                    session_id: session.id,
                    title: session.title,
                    exercise_count: session.exercises.length,
                  }),
                },
              ],
              stream: true,
              max_tokens: 200,
              temperature: 0.7,
            });

            for await (const followChunk of followUp) {
              const followDelta = followChunk.choices[0]?.delta;
              if (followDelta?.content) {
                fullContent += followDelta.content;
                yield {
                  type: 'text_delta',
                  data: { content: followDelta.content },
                };
              }
            }
          } catch (error) {
            console.error('Tool execution failed:', error);
            const errMsg =
              "Sorry, I couldn't create that workout right now. Try again.";
            fullContent += errMsg;
            yield { type: 'text_delta', data: { content: errMsg } };
          }
        } else if (toolCallName === 'modify_plan_days') {
            try {
              const args = safeParseToolArgs(toolCallArgs);
              console.log('[modify_plan_days] User message:', dto.content);
              console.log('[modify_plan_days] Tool args:', JSON.stringify(args, null, 2));

              // Guard: detect when tool args contradict the user's request
              const mismatch = this.detectMuscleGroupMismatch(dto.content, args);
              if (mismatch) {
                console.warn('[modify_plan_days] Mismatch detected:', mismatch);
                // Retry with explicit correction
                const retryStream = await this.openai.chat.completions.create({
                  model,
                  messages: [
                    ...messages,
                    {
                      role: 'system',
                      content: `CORRECTION: The user asked "${dto.content}" but you generated tool args targeting "${mismatch.got}" instead of "${mismatch.expected}". Redo the tool call with the correct muscle group: ${mismatch.expected}. Do NOT use ${mismatch.got}.`,
                    },
                  ],
                  tools,
                  max_tokens: 1000,
                  temperature: 0.2,
                });
                const retryChoice = retryStream.choices[0];
                if (retryChoice?.message?.tool_calls?.[0]) {
                  const retryTc = retryChoice.message.tool_calls[0] as any;
                  toolCallId = retryTc.id ?? toolCallId;
                  toolCallArgs = retryTc.function?.arguments ?? toolCallArgs;
                  console.log('[modify_plan_days] Retry args:', toolCallArgs);
                }
              }

              const retryArgs = safeParseToolArgs(toolCallArgs);
              const daysToModify = retryArgs.days as any[];
              const plan = await this.prisma.trainingPlan.findFirst({
                where: { user_id: userId, is_active: true },
                orderBy: { created_at: 'desc' },
                include: { days: true },
              });

              if (!plan) {
                const errMsg = "You don't have an active training plan yet. Ask me to build one first!";
                fullContent += errMsg;
                yield { type: 'text_delta', data: { content: errMsg } };
              } else if (!daysToModify?.length) {
                const errMsg = "I couldn't determine which days to modify. Could you be more specific?";
                fullContent += errMsg;
                yield { type: 'text_delta', data: { content: errMsg } };
              } else if (plan && daysToModify?.length > 0) {
                const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const modifiedSummary: { day: string; day_type: string; session_title?: string; muscle_groups?: string[] }[] = [];

                await this.prisma.$transaction(async (tx) => {
                  for (const dayArgs of daysToModify) {
                    const planDay = plan.days.find(
                      (d) => d.day_of_week === dayArgs.day_of_week,
                    );
                    if (planDay && planDay.status !== 'completed') {
                      const updateData: any = {
                        day_type: dayArgs.day_type,
                        session_title: dayArgs.session_title ?? null,
                        session_type: dayArgs.session_type ?? null,
                        muscle_groups: dayArgs.muscle_groups ?? [],
                        status: 'pending',
                      };
                      // Only overwrite exercises if explicitly provided; preserve existing otherwise
                      if (dayArgs.exercises && dayArgs.exercises.length > 0) {
                        updateData.exercises_json = dayArgs.exercises;
                      } else if (dayArgs.day_type === 'rest') {
                        updateData.exercises_json = [];
                      }
                      await tx.planDay.update({
                        where: { id: planDay.id },
                        data: updateData,
                      });
                      modifiedSummary.push({
                        day: dayLabels[dayArgs.day_of_week] ?? 'Day',
                        day_type: dayArgs.day_type,
                        session_title: dayArgs.session_title,
                        muscle_groups: dayArgs.muscle_groups,
                      });
                    }
                  }
                });

                // Feed tool result back
                const followUp = await this.openai.chat.completions.create({
                  model,
                  messages: [
                    ...messages,
                    {
                      role: 'assistant',
                      content: fullContent || null,
                      tool_calls: [
                        {
                          id: toolCallId,
                          type: 'function',
                          function: {
                            name: toolCallName,
                            arguments: toolCallArgs,
                          },
                        },
                      ],
                    },
                    {
                      role: 'tool',
                      tool_call_id: toolCallId,
                      content: JSON.stringify({
                        success: true,
                        user_request: dto.content,
                        days_modified: modifiedSummary,
                        days_count: modifiedSummary.length,
                      }),
                    },
                  ],
                  stream: true,
                  max_tokens: 300,
                  temperature: 0.7,
                });

                for await (const followChunk of followUp) {
                  const followDelta = followChunk.choices[0]?.delta;
                  if (followDelta?.content) {
                    fullContent += followDelta.content;
                    yield {
                      type: 'text_delta',
                      data: { content: followDelta.content },
                    };
                  }
                }

                // Notify iOS to reload plan/home data
                yield {
                  type: 'plan_modified',
                  data: { days_count: modifiedSummary.length },
                };
              }
            } catch (error) {
              console.error('Plan modification failed:', error);
              const errMsg = "Sorry, I couldn't modify the plan right now. Try again.";
              fullContent += errMsg;
              yield { type: 'text_delta', data: { content: errMsg } };
            }
          }
      }
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

  // ── Private Helpers ────────────────────────────────────

  private async createWorkoutSession(
    userId: string,
    args: {
      title: string;
      type: string;
      exercises: {
        library_exercise_id?: string;
        name: string;
        muscle_group: string;
        sets_display: string;
      }[];
      ai_message: string;
    },
    exerciseLibrary: any[],
  ) {
    const exerciseMap = new Map(exerciseLibrary.map((e) => [e.id, e]));
    const onboarding = await this.prisma.onboardingData.findFirst({
      where: {
        user_id: userId,
      },
    });

    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: args.title || "Today's Session",
        type: args.type || 'strength',
        status: 'proposed',
        duration_minutes: onboarding?.workout_duration ?? null,
        ai_generated: true,
        ai_message: args.ai_message,
        updated_at: new Date(),
        exercises: {
          create: args.exercises.map((ex, i) => {
            const libEx = ex.library_exercise_id
              ? exerciseMap.get(ex.library_exercise_id)
              : null;
            return {
              library_exercise_id: libEx ? ex.library_exercise_id : null,
              name: libEx?.name ?? ex.name,
              muscle_group: libEx?.muscle_group ?? ex.muscle_group,
              equipment: libEx?.equipment ?? null,
              step_number: i + 1,
              sets_display: ex.sets_display || '3 × 10',
              accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
            };
          }),
        },
      },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
        },
      },
    });

    return session;
  }

  private async getExerciseLibrary(userId: string) {
    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    const allowedEquipment = onboarding
      ? EQUIPMENT_MAP[onboarding.available_equipment]
      : undefined;
    const equipmentFilter =
      allowedEquipment && allowedEquipment.length > 0
        ? { equipment: { in: allowedEquipment } }
        : {};

    return this.prisma.exerciseLibrary.findMany({
      where: {
        OR: [{ is_system: true }, { user_id: userId }],
        ...equipmentFilter,
      },
      orderBy: { name: 'asc' },
    });
  }

  private async getRecentSessions(userId: string, days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: since },
      },
      orderBy: { completed_at: 'desc' },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
        },
      },
    });
  }

  private async getWeekStats(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [completedCount, onboarding] = await Promise.all([
      this.prisma.workoutSession.count({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: weekStart, lt: weekEnd },
        },
      }),
      this.prisma.onboardingData.findUnique({
        where: { user_id: userId },
        select: { training_frequency: true },
      }),
    ]);

    const dayOfWeek = now.getDay();
    const daysLeftInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

    return {
      completedThisWeek: completedCount,
      targetPerWeek: onboarding?.training_frequency ?? 3,
      daysLeftInWeek,
    };
  }

  private buildSystemPrompt(
    userName: string | null,
    onboarding: any,
    recentSessions: any[],
    weekStats: {
      completedThisWeek: number;
      targetPerWeek: number;
      daysLeftInWeek: number;
    },
    exerciseLibrary: any[],
    quickWorkout: any,
    activePlanData?: any,
  ): string {
    const nameLine = userName ? `User name: ${userName}` : '';

    const profile = onboarding
      ? `User profile:
${nameLine ? nameLine + '\n' : ''}- Goal: ${onboarding.primary_goals?.[0]}
- Sport: ${onboarding.primary_sports?.[0]}
- Experience: ${onboarding.experience_level}
- Training frequency target: ${onboarding.training_frequency}x per week
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}`
      : 'No onboarding profile available.';

    const sessionsContext = this.formatRecentSessions(recentSessions);

    // Cap exercise list to avoid bloating the system prompt (~15K+ tokens with 700+ exercises)
    // Diversify by muscle group so all groups are represented
    const MAX_EXERCISES = 150;
    let cappedLibrary = exerciseLibrary;
    if (exerciseLibrary.length > MAX_EXERCISES) {
      const byGroup = new Map<string, any[]>();
      for (const e of exerciseLibrary) {
        const group = e.muscle_group ?? 'Other';
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group)!.push(e);
      }
      cappedLibrary = [];
      const groups = [...byGroup.keys()];
      let idx = 0;
      while (cappedLibrary.length < MAX_EXERCISES && idx < exerciseLibrary.length) {
        for (const g of groups) {
          const arr = byGroup.get(g)!;
          if (idx < arr.length) cappedLibrary.push(arr[idx]);
          if (cappedLibrary.length >= MAX_EXERCISES) break;
        }
        idx++;
      }
    }
    const exerciseList =
      cappedLibrary.length > 0
        ? `Available exercises (use these library_exercise_id values when creating workouts — ${exerciseLibrary.length} total, showing ${cappedLibrary.length}):\n${cappedLibrary
            .map(
              (e) =>
                `- ${e.name} (id: ${e.id}, muscle: ${e.muscle_group}, equipment: ${e.equipment})`,
            )
            .join('\n')}`
        : 'No exercise library available.';

    const currentSession = quickWorkout
      ? `Current quick workout: "${quickWorkout.title}" with ${quickWorkout.exercises.length} exercises: ${quickWorkout.exercises.map((e: any) => e.name).join(', ')}`
      : 'No current quick workout.';

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;

    let planContext = 'No active training plan.';
    if (activePlanData?.plan && activePlanData.days?.length > 0) {
      const weekNum = activePlanData.plan.weekNumber;
      const dayLines = activePlanData.days.map((d: any) => {
        const label = d.dayLabel ?? dayLabels[d.dayOfWeek] ?? 'Day';
        const isToday = d.dayOfWeek === todayDow;
        const todayMarker = isToday ? ' ← TODAY' : '';
        if (d.dayType === 'rest') {
          return `- ${label}: Rest Day${todayMarker} — ${d.status}`;
        }
        const muscles = d.muscleGroups?.join(', ') ?? '';
        return `- ${label}: ${d.sessionTitle ?? 'Training'} (${muscles})${todayMarker} — ${d.status}`;
      });
      planContext = `Current training plan (Week ${weekNum}):\n${dayLines.join('\n')}`;
    }

    return `You are a no-nonsense strength coach for the GymBro app.
You have full context about the user's training. Help them with workout plans, exercise adjustments, and training advice.

Tool usage rules:
- When the user asks to "create a workout", "build me a workout", "give me a workout for today", or anything about generating a new session → call create_workout_session immediately. Do NOT ask clarifying questions — just pick exercises that match their profile and goal.
- Use modify_plan_days for any plan changes — single day or bulk. When the user asks to change their plan (e.g. "swap Tuesday to chest", "focus this week on arms", "make Friday a rest day"), use this tool.
- CRITICAL: When the user specifies a muscle group or focus (e.g. "arms", "back", "chest"), you MUST use exactly that focus in the tool call. Never substitute a different muscle group. If the user says "arms", the session titles, muscle groups, and exercises MUST target arms — not legs, not chest, not any other group.
- Reference the training plan context above when user asks about their plan.
- NEVER list exercises as plain text. Always use the tool so the session is saved.
When giving advice or answering questions — respond in text only.

Keep responses concise (2-3 sentences max for text replies).

${profile}

Week progress: ${weekStats.completedThisWeek}/${weekStats.targetPerWeek} workouts completed, ${weekStats.daysLeftInWeek} days left in the week.

${planContext}

${sessionsContext}

${currentSession}

${exerciseList}

Rules:
- Pick 4-6 exercises when creating workouts
- Vary muscle groups for balanced sessions
- Avoid exercises that would aggravate listed injuries
- Match rep scheme to the user's goal
- ONLY use library_exercise_id values from the available exercises list above when creating workouts
- Be direct and concise — no cheerleading`;
  }

  private formatRecentSessions(sessions: any[]): string {
    if (sessions.length === 0) return 'No recent sessions in the last 14 days.';

    const blocks = sessions.map((s) => {
      const date = s.completed_at
        ? new Date(s.completed_at).toISOString().split('T')[0]
        : 'unknown';
      const duration = s.duration_minutes
        ? `${s.duration_minutes} min`
        : 'unknown duration';
      const exerciseLines = s.exercises.map((e: any) => {
        const sets = e.exercise_sets;
        if (!sets || sets.length === 0)
          return `  - ${e.name} (${e.muscle_group}): no sets logged`;
        const setDetails = sets
          .map((set: any) => {
            const weight = set.weight
              ? `${Number(set.weight)} ${set.weight_unit}`
              : 'BW';
            return `${weight} × ${set.reps}`;
          })
          .join(', ');
        return `  - ${e.name} (${e.muscle_group}): ${setDetails}`;
      });
      return `${date} — "${s.title}" (${duration})\n${exerciseLines.join('\n')}`;
    });

    return `Session log (last 14 days):\n${blocks.join('\n\n')}`;
  }

  /**
   * Detect when OpenAI tool args target a different muscle group than the user requested.
   * Returns null if no mismatch, or { expected, got } if there's a clear contradiction.
   */
  private detectMuscleGroupMismatch(
    userMessage: string,
    toolArgs: Record<string, any>,
  ): { expected: string; got: string } | null {
    const muscleKeywords: Record<string, string[]> = {
      arms: ['arms', 'biceps', 'triceps', 'arm'],
      legs: ['legs', 'leg', 'quads', 'hamstrings', 'glutes', 'calves'],
      chest: ['chest', 'pecs', 'pectoral'],
      back: ['back', 'lats', 'lat'],
      shoulders: ['shoulders', 'shoulder', 'delts'],
      core: ['core', 'abs', 'abdominal'],
    };

    const msgLower = userMessage.toLowerCase();

    // Find what the user asked for
    let userTarget: string | null = null;
    for (const [group, keywords] of Object.entries(muscleKeywords)) {
      if (keywords.some((kw) => msgLower.includes(kw))) {
        userTarget = group;
        break;
      }
    }
    if (!userTarget) return null; // Can't determine user intent

    // Check what the tool args contain
    const argsStr = JSON.stringify(toolArgs).toLowerCase();
    for (const [group, keywords] of Object.entries(muscleKeywords)) {
      if (group === userTarget) continue;
      const targetKeywords = muscleKeywords[userTarget];
      const hasWrongGroup = keywords.some((kw) => argsStr.includes(kw));
      const hasRightGroup = targetKeywords.some((kw) => argsStr.includes(kw));
      if (hasWrongGroup && !hasRightGroup) {
        return { expected: userTarget, got: group };
      }
    }

    return null;
  }

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
