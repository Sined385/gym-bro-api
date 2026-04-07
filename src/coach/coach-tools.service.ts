import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { exerciseImageUrl } from '../common/exercise-image';
import {
  matchExercisesToSlots,
  normalizeMuscleGroup,
  ExerciseSlot,
} from '../plans/exercise-matcher';
import {
  SSEEvent,
  safeParseToolArgs,
  streamToolFollowUp,
} from './coach-stream.helper';

export interface ToolCallParams {
  toolName: string;
  toolCallId: string;
  toolCallArgs: string;
  userId: string;
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  fullContent: string;
  exerciseLibrary: any[];
  userMessage: string;
  onboarding: any;
  activePlanData: any;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}

export interface ToolCallResult {
  followUpContent: string;
  sessionId: string | null;
}

@Injectable()
export class CoachToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly aiUsage: AiUsageService,
  ) {}

  getToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
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
              duration_minutes: {
                type: 'number',
                description:
                  'Target workout duration in minutes. Use the value the user requested (e.g. 30 for a "30 min workout"). If the user did not specify, omit this field.',
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
            "Modify one or more days in the user's weekly training plan. Use this when the user asks to change, swap, or adjust days in their plan — supports single day or bulk changes.",
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
                      description:
                        'Day of week to modify: 0=Monday, 1=Tuesday, ..., 6=Sunday',
                    },
                    day_type: {
                      type: 'string',
                      enum: ['training', 'rest'],
                      description:
                        'Whether this should be a training or rest day',
                    },
                    session_title: {
                      type: 'string',
                      description: 'New session title (for training days)',
                    },
                    session_type: {
                      type: 'string',
                      enum: [
                        'strength',
                        'cardio',
                        'mobility',
                        'hiit',
                        'custom',
                      ],
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
      {
        type: 'function',
        function: {
          name: 'generate_training_plan',
          description:
            "Generate a full weekly training plan for the user. Use this when the user asks to build, create, or generate their training plan (e.g. 'Build my plan', 'Create a weekly plan', 'Generate my training plan'). This creates a complete 7-day plan with rest days and training days. Do NOT use create_workout_session for this — that tool is only for single ad-hoc workouts.",
          parameters: {
            type: 'object',
            properties: {
              force: {
                type: 'boolean',
                description:
                  'If true, replaces the current active plan. Set to true when the user already has a plan and wants a new one.',
              },
            },
          },
        },
      },
    ];
  }

  async *handleToolCall(
    params: ToolCallParams,
  ): AsyncGenerator<
    SSEEvent & { _sessionId?: string; _followUpContent?: string }
  > {
    switch (params.toolName) {
      case 'create_workout_session':
        yield* this.handleCreateWorkoutSession(params);
        break;
      case 'modify_plan_days':
        yield* this.handleModifyPlanDays(params);
        break;
      case 'generate_training_plan':
        yield* this.handleGenerateTrainingPlan(params);
        break;
    }
  }

  // ── Tool Handlers ────────────────────────────────────

  private async *handleCreateWorkoutSession(
    params: ToolCallParams,
  ): AsyncGenerator<
    SSEEvent & { _sessionId?: string; _followUpContent?: string }
  > {
    try {
      const args = safeParseToolArgs(params.toolCallArgs) as any;
      const session = await this.createWorkoutSession(
        params.userId,
        args,
        params.exerciseLibrary,
      );

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
              image_url: exerciseImageUrl(e.external_id),
              external_id: e.external_id ?? null,
            })),
          },
        },
        _sessionId: session.id,
      };

      // Feed tool result back and get final message
      for await (const event of streamToolFollowUp({
        openai: params.openai,
        model: params.model,
        messages: params.messages,
        toolCallId: params.toolCallId,
        toolCallName: params.toolName,
        toolCallArgs: params.toolCallArgs,
        toolResult: JSON.stringify({
          success: true,
          session_id: session.id,
          title: session.title,
          exercise_count: session.exercises.length,
        }),
        fullContent: params.fullContent,
        maxTokens: 200,
        aiUsage: this.aiUsage,
        userId: params.userId,
        feature: 'coach_chat',
      })) {
        yield event;
      }
    } catch (error) {
      console.error('Tool execution failed:', error);
      console.error('Tool args were:', params.toolCallArgs);
      const errMsg =
        "Sorry, I couldn't create that workout right now. Try again.";
      yield {
        type: 'text_delta',
        data: { content: errMsg },
        _followUpContent: errMsg,
      };
    }
  }

  private async *handleModifyPlanDays(
    params: ToolCallParams,
  ): AsyncGenerator<SSEEvent & { _followUpContent?: string }> {
    try {
      const args = safeParseToolArgs(params.toolCallArgs);
      console.log('[modify_plan_days] User message:', params.userMessage);
      console.log(
        '[modify_plan_days] Tool args:',
        JSON.stringify(args, null, 2),
      );

      let { toolCallId, toolCallArgs } = params;

      // Guard: detect when tool args contradict the user's request
      const mismatch = this.detectMuscleGroupMismatch(params.userMessage, args);
      if (mismatch) {
        console.warn('[modify_plan_days] Mismatch detected:', mismatch);
        // Retry with explicit correction
        const retryStream = await params.openai.chat.completions.create({
          model: params.model,
          messages: [
            ...params.messages,
            {
              role: 'system',
              content: `CORRECTION: The user asked "${params.userMessage}" but you generated tool args targeting "${mismatch.got}" instead of "${mismatch.expected}". Redo the tool call with the correct muscle group: ${mismatch.expected}. Do NOT use ${mismatch.got}.`,
            },
          ],
          tools: params.tools,
          max_tokens: 1000,
          temperature: 0.2,
        });
        if (retryStream.usage) {
          this.aiUsage.trackUsage({
            userId: params.userId,
            feature: 'coach_chat',
            model: params.model,
            promptTokens: retryStream.usage.prompt_tokens,
            completionTokens: retryStream.usage.completion_tokens,
          });
        }
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
        where: { user_id: params.userId, is_active: true },
        orderBy: { created_at: 'desc' },
        include: { days: true },
      });

      if (!plan) {
        const errMsg =
          "You don't have an active training plan yet. Ask me to build one first!";
        yield {
          type: 'text_delta',
          data: { content: errMsg },
          _followUpContent: errMsg,
        };
        return;
      }

      if (!daysToModify?.length) {
        const errMsg =
          "I couldn't determine which days to modify. Could you be more specific?";
        yield {
          type: 'text_delta',
          data: { content: errMsg },
          _followUpContent: errMsg,
        };
        return;
      }

      const dayLabels = [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ];
      const modifiedSummary: {
        day: string;
        day_type: string;
        session_title?: string;
        muscle_groups?: string[];
      }[] = [];

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
            if (dayArgs.day_type === 'rest') {
              updateData.exercises_json = [];
            } else if (dayArgs.exercises && dayArgs.exercises.length > 0) {
              // AI provided explicit exercises — enrich with external_id
              const exerciseMap = new Map(
                params.exerciseLibrary.map((e) => [e.id, e]),
              );
              const nameMap = new Map(
                params.exerciseLibrary
                  .filter((e) => e.external_id)
                  .map((e) => [e.name, e.external_id]),
              );
              updateData.exercises_json = dayArgs.exercises.map((ex: any) => {
                const libEx = ex.library_exercise_id
                  ? exerciseMap.get(ex.library_exercise_id)
                  : null;
                return {
                  ...ex,
                  external_id:
                    libEx?.external_id ?? nameMap.get(ex.name) ?? null,
                };
              });
            } else if (
              dayArgs.muscle_groups &&
              dayArgs.muscle_groups.length > 0
            ) {
              // AI provided muscle groups but no exercises — auto-pick from library
              const repScheme =
                params.onboarding?.primary_goals?.[0] === 'get_stronger'
                  ? '4 × 6'
                  : params.onboarding?.primary_goals?.[0] === 'lose_fat'
                    ? '3 × 12'
                    : '3 × 10';
              const slots: ExerciseSlot[] = [];
              for (const mg of dayArgs.muscle_groups) {
                const normalized = normalizeMuscleGroup(mg);
                slots.push({
                  muscle_group: normalized,
                  rep_scheme: repScheme,
                  focus: slots.some((s) => s.muscle_group === normalized)
                    ? 'isolation'
                    : 'compound',
                });
              }
              // Pad to 5 exercises if fewer muscle groups
              while (slots.length < 5) {
                const mg =
                  dayArgs.muscle_groups[
                    slots.length % dayArgs.muscle_groups.length
                  ];
                slots.push({
                  muscle_group: normalizeMuscleGroup(mg),
                  rep_scheme: repScheme,
                  focus: 'isolation',
                });
              }
              const picks = matchExercisesToSlots(
                slots,
                params.exerciseLibrary as any,
                new Set(),
                params.onboarding?.experience_level ?? null,
              );
              updateData.exercises_json = picks.map((pick, i) => ({
                library_exercise_id: pick.id,
                external_id: pick.external_id,
                name: pick.name,
                muscle_group: pick.muscle_group,
                equipment: pick.equipment,
                sets_display: slots[i]?.rep_scheme ?? repScheme,
              }));
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
      for await (const event of streamToolFollowUp({
        openai: params.openai,
        model: params.model,
        messages: params.messages,
        toolCallId,
        toolCallName: params.toolName,
        toolCallArgs,
        toolResult: JSON.stringify({
          success: true,
          user_request: params.userMessage,
          days_modified: modifiedSummary,
          days_count: modifiedSummary.length,
        }),
        fullContent: params.fullContent,
        maxTokens: 300,
        aiUsage: this.aiUsage,
        userId: params.userId,
        feature: 'coach_chat',
      })) {
        yield event;
      }

      // Notify iOS to reload plan/home data
      yield {
        type: 'plan_modified',
        data: { days_count: modifiedSummary.length },
      };
    } catch (error) {
      console.error('Plan modification failed:', error);
      const errMsg = "Sorry, I couldn't modify the plan right now. Try again.";
      yield {
        type: 'text_delta',
        data: { content: errMsg },
        _followUpContent: errMsg,
      };
    }
  }

  private async *handleGenerateTrainingPlan(
    params: ToolCallParams,
  ): AsyncGenerator<SSEEvent & { _followUpContent?: string }> {
    try {
      const args = safeParseToolArgs(params.toolCallArgs);
      const force = args.force === true || !!params.activePlanData?.plan;
      const result = await this.plansService.generatePlan(params.userId, force);

      yield {
        type: 'plan_generated',
        data: { plan_id: (result as any).planId ?? null },
      };

      // Feed tool result back and get final message
      for await (const event of streamToolFollowUp({
        openai: params.openai,
        model: params.model,
        messages: params.messages,
        toolCallId: params.toolCallId,
        toolCallName: params.toolName,
        toolCallArgs: params.toolCallArgs,
        toolResult: JSON.stringify({
          success: true,
          message: (result as any).message,
          plan_id: (result as any).planId ?? null,
        }),
        fullContent: params.fullContent,
        maxTokens: 300,
        aiUsage: this.aiUsage,
        userId: params.userId,
        feature: 'coach_chat',
      })) {
        yield event;
      }
    } catch (error) {
      console.error('Plan generation failed:', error);
      const errMsg =
        "Sorry, I couldn't generate your plan right now. Try again.";
      yield {
        type: 'text_delta',
        data: { content: errMsg },
        _followUpContent: errMsg,
      };
    }
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
      duration_minutes?: number;
    },
    exerciseLibrary: any[],
  ) {
    const exerciseMap = new Map(exerciseLibrary.map((e) => [e.id, e]));
    const onboarding = await this.prisma.onboardingData.findFirst({
      where: {
        user_id: userId,
      },
    });

    const exercises = args.exercises ?? [];
    if (exercises.length === 0) {
      throw new Error('No exercises provided for workout session');
    }

    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: args.title || "Today's Session",
        type: args.type || 'strength',
        status: 'proposed',
        duration_minutes:
          args.duration_minutes ?? onboarding?.workout_duration ?? null,
        ai_generated: true,
        ai_message: args.ai_message,
        updated_at: new Date(),
        exercises: {
          create: exercises.map((ex, i) => {
            const libEx = ex.library_exercise_id
              ? exerciseMap.get(ex.library_exercise_id)
              : null;
            return {
              library_exercise_id: libEx ? ex.library_exercise_id : null,
              external_id: libEx?.external_id ?? null,
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
}
