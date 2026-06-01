import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import {
  PlanGeneratorService,
  WorkoutSlotInput,
} from '../plans/plan-generator.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { toMondayDow } from '../common/date-utils';
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
    private readonly planGenerator: PlanGeneratorService,
    private readonly aiUsage: AiUsageService,
  ) {}

  getToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'create_workout_session',
          description:
            'Create a new workout session. Propose the STRUCTURE (which muscle groups, how many slots, what rep scheme); the server filters its exercise library per group and runs a second AI pass to pick the actual exercises. You do not pick exercises here — only the shape of the workout.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Session title' },
              type: {
                type: 'string',
                enum: ['strength', 'cardio', 'mobility', 'hiit', 'custom'],
              },
              slots: {
                type: 'array',
                description:
                  'One entry per exercise slot in the workout. Order matters — slot[0] is exercise #1. Build a BALANCED workout: max 2 slots per muscle_group, the rest spread across complementary groups (Chest↔Triceps/Shoulders, Back↔Biceps, Legs↔Core). When the user names a specific lift in `focus` ("bench press", "deadlift"), put exactly ONE slot in that lift\'s muscle_group as the primary, optionally ONE accessory slot in the SAME group, and use the remaining slots for supporting groups — never fill 4–5 slots with the same muscle_group just because the user named a lift.',
                items: {
                  type: 'object',
                  properties: {
                    muscle_group: {
                      type: 'string',
                      enum: [
                        'Chest',
                        'Back',
                        'Legs',
                        'Shoulders',
                        'Arms',
                        'Core',
                      ],
                    },
                    sets_display: {
                      type: 'string',
                      description:
                        'Sets and reps in "N × M" format, e.g. "4 × 8". Optional — defaults to "3 × 10".',
                    },
                  },
                  required: ['muscle_group'],
                },
              },
              focus: {
                type: 'string',
                description:
                  'Optional. Pass the user\'s message verbatim when they named either a specific lift ("dumbbell bench press", "deadlift", "front squat") OR a specific equipment type ("dumbbells", "barbell only", "machines"). The server parses this to (a) narrow the candidate pool to that equipment when an equipment word is present, or (b) force-include the matching library entry when a specific lift is named. Omit only when the user gave no equipment or lift preference.',
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
            required: ['title', 'type', 'slots', 'ai_message'],
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
              focus: {
                type: 'string',
                description:
                  'Optional free-form focus from the user\'s message. If they asked for a "bench press plan" or "powerlifting week" or "arms-heavy plan", pass that phrasing verbatim here. The plan generator uses it to bias the skeleton (more compound slots for that movement) and exercise selection (prefer the named lift and its variations). Omit when no specific focus was requested.',
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

      // Two-stage workout assembly:
      //   1. Coach proposes the structure (slots = muscle group sequence
      //      + optional rep schemes + optional named-lift focus).
      //   2. Server filters its library per group, force-includes the named
      //      lift if any, then runs a second AI pass to pick specific
      //      exercises from those small pools.
      // This mirrors the plan-generation flow and prevents Coach from
      // picking a variant ("Decline DB Bench Press") when the user asked
      // for the canonical lift ("Dumbbell Bench Press").
      const slots: WorkoutSlotInput[] = Array.isArray(args.slots)
        ? args.slots
            .filter((s: any) => s && typeof s.muscle_group === 'string')
            .map((s: any) => ({
              muscle_group: s.muscle_group,
              sets_display:
                typeof s.sets_display === 'string'
                  ? s.sets_display
                  : undefined,
            }))
        : [];
      const focus =
        typeof args.focus === 'string' && args.focus.trim().length > 0
          ? args.focus.trim()
          : undefined;

      const picked =
        slots.length > 0
          ? await this.planGenerator.pickExercisesForWorkout(
              params.userId,
              slots,
              focus,
            )
          : [];

      // Build the createWorkoutSession arg shape from the picked exercises.
      const sessionArgs = {
        title: args.title,
        type: args.type,
        ai_message: args.ai_message,
        duration_minutes: args.duration_minutes,
        exercises: picked.map((p) => ({
          library_exercise_id: p.library_exercise_id,
          name: p.name,
          muscle_group: p.muscle_group,
          sets_display: p.sets_display,
        })),
      };

      // Belt-and-suspenders: even with the two-stage flow + focus-injection,
      // double-check the user's named lifts ended up in the session and
      // inject any that didn't. Cheap insurance.
      this.enforceNamedLifts(
        sessionArgs,
        params.userMessage,
        params.exerciseLibrary,
      );

      const session = await this.createWorkoutSession(
        params.userId,
        sessionArgs,
        params.exerciseLibrary,
      );

      // Wire the new session into the user's plan: today's plan day adopts
      // it; today's original workout (if any) is bumped to the next pending
      // training day so the week stays coherent.
      const planChange = await this.linkSessionToTodayAndRebalance(
        params.userId,
        session.id,
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
          plan_today_updated: planChange.todayUpdated,
          plan_displaced_to: planChange.movedToDayLabel,
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
      const focus =
        typeof args.focus === 'string' && args.focus.trim().length > 0
          ? args.focus.trim()
          : undefined;
      const result = await this.plansService.generatePlan(
        params.userId,
        force,
        focus,
      );

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

  /**
   * Splice a freshly created workout into the user's active plan:
   *   - Today's PlanDay adopts the session (title, exercises, muscle groups,
   *     workout_session_id, status='pending', day_type='training').
   *   - If today was originally a training day with exercises, those original
   *     exercises move to the next pending training day this week so the week
   *     stays coherent (chest swapped with what was scheduled for that day).
   *
   * Silently no-ops when there's no active plan, today isn't in the plan,
   * or today's plan day is already completed (don't overwrite a finished day).
   */
  private async linkSessionToTodayAndRebalance(
    userId: string,
    sessionId: string,
  ): Promise<{
    todayUpdated: boolean;
    movedToDayLabel: string | null;
  }> {
    const dayLabels = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const todayDow = toMondayDow(new Date());

    const plan = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });
    if (!plan) return { todayUpdated: false, movedToDayLabel: null };

    const todayDay = plan.days.find((d) => d.day_of_week === todayDow);
    if (!todayDay || todayDay.status === 'completed') {
      return { todayUpdated: false, movedToDayLabel: null };
    }

    const session = await this.prisma.workoutSession.findUnique({
      where: { id: sessionId },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });
    if (!session) return { todayUpdated: false, movedToDayLabel: null };

    // Snapshot today's original workout so we can relocate it.
    const originalDayType = todayDay.day_type;
    const originalTitle = todayDay.session_title;
    const originalSessionType = todayDay.session_type;
    const originalMuscleGroups = todayDay.muscle_groups;
    const originalExercises = todayDay.exercises_json;
    const originalIsTrainingWithContent =
      originalDayType === 'training' &&
      Array.isArray(originalExercises) &&
      (originalExercises as unknown[]).length > 0;

    // Shape today's PlanDay.exercises_json from the new session's exercises.
    const newExercisesJson = session.exercises.map((e) => ({
      library_exercise_id: e.library_exercise_id ?? null,
      external_id: e.external_id ?? null,
      name: e.name,
      muscle_group: e.muscle_group ?? null,
      equipment: e.equipment ?? null,
      sets_display: e.sets_display,
    }));
    const muscleGroups = [
      ...new Set(
        session.exercises
          .map((e) => e.muscle_group)
          .filter((m): m is string => !!m),
      ),
    ];

    let movedToDayLabel: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.planDay.update({
        where: { id: todayDay.id },
        data: {
          day_type: 'training',
          session_title: session.title,
          session_type: session.type,
          muscle_groups: muscleGroups,
          exercises_json: newExercisesJson,
          workout_session_id: session.id,
          status: 'pending',
          adapted_at: new Date(),
        },
      });

      if (!originalIsTrainingWithContent) return;
      const targetDay = plan.days.find(
        (d) =>
          d.day_of_week > todayDow &&
          d.day_type === 'training' &&
          d.status === 'pending' &&
          d.id !== todayDay.id,
      );
      if (!targetDay) return;
      await tx.planDay.update({
        where: { id: targetDay.id },
        data: {
          session_title: originalTitle,
          session_type: originalSessionType,
          muscle_groups: originalMuscleGroups,
          exercises_json: originalExercises as any,
          status: 'pending',
          workout_session_id: null,
          adapted_at: new Date(),
        },
      });
      movedToDayLabel = dayLabels[targetDay.day_of_week] ?? null;
    });

    return { todayUpdated: true, movedToDayLabel };
  }

  /**
   * Parses the user's message for explicit lift names that exist in the
   * library and ensures they appear in the AI's chosen exercises. Auto-
   * injects missing ones at the front of the list.
   *
   * Why: the system prompt asks the model to honor the user's exact lift
   * name, but the model still substitutes ("dumbbell bench press" becomes
   * "decline dumbbell bench press" or "incline dumbbell bench press"). The
   * priority chain is the user's intent, and that must hold deterministically
   * — prompt rules alone don't, so we enforce server-side.
   *
   * Matching:
   *  - Longest library-name substring match wins per position in the
   *    message (so "dumbbell bench press" doesn't also pull in "bench press").
   *  - Case-insensitive.
   *  - Idempotent against what the AI already chose: skips lifts the AI
   *    included by library_exercise_id or by exact name.
   */
  private enforceNamedLifts(
    args: any,
    userMessage: string,
    exerciseLibrary: any[],
  ): void {
    if (!userMessage || !Array.isArray(args.exercises)) return;
    const lower = userMessage.toLowerCase();

    // Collect (exercise, startIndex) hits. Sort by name length desc so the
    // most specific phrasing wins when two library entries both substring-
    // match overlapping spans.
    type Hit = { ex: any; start: number };
    const hits: Hit[] = [];
    for (const ex of exerciseLibrary) {
      const name = (ex.name as string).toLowerCase();
      // Minimum length filter to avoid trivial matches (e.g. "Pull" or
      // single-word generic lifts triggering on unrelated chatter).
      if (name.length < 6) continue;
      const idx = lower.indexOf(name);
      if (idx >= 0) hits.push({ ex, start: idx });
    }
    hits.sort((a, b) => b.ex.name.length - a.ex.name.length);

    // Resolve overlapping spans — keep the longest, drop overlaps.
    const claimed = new Array<boolean>(lower.length).fill(false);
    const required: any[] = [];
    for (const { ex, start } of hits) {
      const end = start + ex.name.length;
      let conflict = false;
      for (let i = start; i < end; i++) {
        if (claimed[i]) { conflict = true; break; }
      }
      if (conflict) continue;
      for (let i = start; i < end; i++) claimed[i] = true;
      required.push(ex);
    }

    if (required.length === 0) return;

    // Skip any the AI already included (by library_exercise_id or exact name).
    const aiNames = new Set<string>(
      args.exercises
        .map((e: any) => (e.name as string | undefined)?.toLowerCase())
        .filter((n: string | undefined) => !!n),
    );
    const aiIds = new Set<string>(
      args.exercises
        .map((e: any) => e.library_exercise_id as string | undefined)
        .filter((id: string | undefined) => !!id),
    );
    const missing = required.filter(
      (ex) => !aiIds.has(ex.id) && !aiNames.has(ex.name.toLowerCase()),
    );
    if (missing.length === 0) return;

    // Inject at the front. The AI's other exercises follow as accessories.
    const injected = missing.map((ex) => ({
      library_exercise_id: ex.id,
      name: ex.name,
      muscle_group: ex.muscle_group ?? null,
      // Sensible default — compound lifts read well as 4 × 8 in this app.
      sets_display: '4 × 8',
    }));
    args.exercises = [...injected, ...args.exercises];
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
