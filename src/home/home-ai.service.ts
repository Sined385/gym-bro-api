import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { ACCENT_COLORS } from './session-exercise.service';
import { WeightSuggestionService } from './weight-suggestion.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { getWeekStart } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { formatRecentSessions } from '../common/format-sessions';
import { aiContextLine } from '../common/ai-context';

const SETS_DISPLAY_BY_GOAL: Record<string, string> = {
  build_muscle: '3 × 10',
  lose_fat: '3 × 12',
  get_stronger: '4 × 6',
  improve_endurance: '3 × 15',
  stay_healthy: '3 × 10',
};

@Injectable()
export class HomeAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
    private readonly weightSuggestionService: WeightSuggestionService,
    private readonly aiUsage: AiUsageService,
  ) {}

  // ── AI Motivation ───────────────────────────────────────

  async getOrGenerateMotivation(userId: string) {
    const now = new Date();

    // Check for cached motivation that's still valid today
    const cached = await this.prisma.motivationInsight.findFirst({
      where: {
        user_id: userId,
        valid_until: { gt: now },
      },
      orderBy: { created_at: 'desc' },
    });

    if (cached) return cached;

    try {
      return await this.generateAIMotivation(userId);
    } catch (error) {
      console.error(
        'AI motivation generation failed, returning fallback:',
        error,
      );
      return this.generateFallbackMotivation(userId);
    }
  }

  private async generateAIMotivation(userId: string) {
    const [onboarding, recentSessions, weekStats, totalSessionCount] =
      await Promise.all([
        this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
        this.getRecentSessions(userId, 14),
        this.getWeekStats(userId),
        this.prisma.workoutSession.count({
          where: { user_id: userId, status: 'completed' },
        }),
      ]);

    const isNewUser = totalSessionCount === 0;

    const systemPrompt = isNewUser
      ? this.buildWelcomePrompt(onboarding)
      : this.buildMotivationPrompt(onboarding, recentSessions, weekStats);

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: "Generate today's motivation message.",
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.6,
    });

    if (response.usage) {
      this.aiUsage.trackUsage({
        userId,
        feature: 'motivation',
        model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
      });
    }

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty OpenAI response');

    const parsed = JSON.parse(content) as {
      title: string;
      message: string;
      personal_records?: string[];
    };

    const motivation = await this.prisma.motivationInsight.create({
      data: {
        user_id: userId,
        title: parsed.title,
        message: parsed.message,
        workouts_this_week: weekStats.completedThisWeek,
        personal_records: parsed.personal_records ?? [],
        valid_until: this.endOfDay(),
      },
    });

    return motivation;
  }

  private async generateFallbackMotivation(userId: string) {
    const [weekStats, totalSessionCount, onboarding] = await Promise.all([
      this.getWeekStats(userId),
      this.prisma.workoutSession.count({
        where: { user_id: userId, status: 'completed' },
      }),
      this.prisma.onboardingData.findUnique({
        where: { user_id: userId },
        select: { primary_goals: true, primary_sports: true },
      }),
    ]);

    // New user — welcome message based on profile
    if (totalSessionCount === 0) {
      const goalLabels: Record<string, string> = {
        build_muscle: 'building muscle',
        lose_fat: 'burning fat',
        get_stronger: 'getting stronger',
        improve_endurance: 'boosting endurance',
        stay_healthy: 'staying healthy',
      };
      const goalLabel =
        goalLabels[onboarding?.primary_goals?.[0] ?? ''] ||
        'your fitness goals';

      return this.prisma.motivationInsight.create({
        data: {
          user_id: userId,
          title: 'Welcome to GymJam',
          message: `Your profile is set up and ready for ${goalLabel}. Start your first workout to get personalized insights.`,
          workouts_this_week: 0,
          personal_records: [],
          valid_until: this.endOfDay(),
        },
      });
    }

    const remaining = weekStats.targetPerWeek - weekStats.completedThisWeek;
    const message =
      remaining > 0
        ? `${weekStats.completedThisWeek}/${weekStats.targetPerWeek} sessions done this week. ${remaining} remaining to stay on track.`
        : `${weekStats.targetPerWeek}/${weekStats.targetPerWeek} sessions done. Weekly target met — consider adding volume or intensity.`;

    return this.prisma.motivationInsight.create({
      data: {
        user_id: userId,
        title: 'Weekly status',
        message,
        workouts_this_week: weekStats.completedThisWeek,
        personal_records: [],
        valid_until: this.endOfDay(),
      },
    });
  }

  private buildMotivationPrompt(
    onboarding: any,
    recentSessions: any[],
    weekStats: {
      completedThisWeek: number;
      targetPerWeek: number;
      daysLeftInWeek: number;
    },
  ): string {
    const profile = onboarding
      ? `User profile:
- Goal: ${onboarding.primary_goals?.[0]}
- Sport: ${onboarding.primary_sports?.[0]}
- Experience: ${onboarding.experience_level}
- Training frequency target: ${onboarding.training_frequency}x per week
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}${aiContextLine(onboarding)}`
      : 'No onboarding profile available.';

    const sessionsContext = formatRecentSessions(recentSessions);

    return `You are a no-nonsense strength coach for the GymJam app.
Your job is to give the user a brief, direct recap of their recent training and one actionable insight for today. No cheerleading, no fluff — just facts and what to do next.

${profile}

Week progress: ${weekStats.completedThisWeek}/${weekStats.targetPerWeek} workouts completed, ${weekStats.daysLeftInWeek} days left in the week.

${sessionsContext}

Respond with a JSON object:
{
  "title": "Short factual title (max 6 words, e.g. 'Legs are behind this week')",
  "message": "1-2 sentences: recap what they did recently, then one concrete tip or observation to help them progress (max 180 chars)",
  "personal_records": ["any recent PRs or notable lifts from the session log, otherwise empty array"]
}

Rules:
- Lead with data: reference specific exercises, weights, reps, or muscle groups from their session log
- Point out patterns: volume trends, muscle groups neglected, weight progression stalling or improving
- Give one actionable suggestion tied to their goal (e.g. "add 5 lbs to your bench next session", "your back volume is low — prioritize rows today")
- Keep the tone direct and matter-of-fact — no exclamation marks, no "great job", no cheerleading
- This appears on a mobile card — be concise`;
  }

  private buildWelcomePrompt(onboarding: any): string {
    const profile = onboarding
      ? `User profile:
- Goal: ${onboarding.primary_goals?.[0]}
- Sport: ${onboarding.primary_sports?.[0]}
- Experience: ${onboarding.experience_level}
- Training frequency target: ${onboarding.training_frequency}x per week
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}${aiContextLine(onboarding)}`
      : 'No onboarding profile available.';

    return `You are a friendly strength coach for the GymJam app.
This is a brand new user who just signed up and hasn't done any workouts yet. Welcome them and get them excited to start their first session.

${profile}

Respond with a JSON object:
{
  "title": "Short welcoming title (max 6 words, e.g. 'Ready to get started?')",
  "message": "1-2 sentences: welcome them, reference their goal or sport, and encourage them to start their first workout (max 180 chars)",
  "personal_records": []
}

Rules:
- Be warm and encouraging — this is their first impression of the app
- Reference their specific goal or sport to make it feel personal
- Do NOT mention missed workouts, streaks, or inactivity — they are brand new
- Keep the tone friendly and motivating
- This appears on a mobile card — be concise`;
  }

  // ── Weekly Overview ────────────────────────────────────

  async getOrGenerateWeeklyOverview(
    userId: string,
    currentWeekStats: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number | null;
      totalCalories: number;
    },
    prev3WeekAvgs: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number;
      totalCalories: number;
    } | null,
  ): Promise<string | null> {
    const weekStart = getWeekStart(new Date());

    // Check cache
    const cached = await this.prisma.weeklyOverview.findUnique({
      where: { user_id_week_start: { user_id: userId, week_start: weekStart } },
    });
    if (cached) return cached.overview;

    // If no current week workouts, nothing to summarize
    if (currentWeekStats.workouts === 0) return null;

    try {
      return await this.generateAIWeeklyOverview(
        userId,
        weekStart,
        currentWeekStats,
        prev3WeekAvgs,
      );
    } catch (error) {
      console.error('AI weekly overview failed, using fallback:', error);
      return this.generateFallbackOverview(currentWeekStats, prev3WeekAvgs);
    }
  }

  private async generateAIWeeklyOverview(
    userId: string,
    weekStart: Date,
    current: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number | null;
      totalCalories: number;
    },
    prev: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number;
      totalCalories: number;
    } | null,
  ): Promise<string> {
    let prompt: string;
    if (prev) {
      prompt = `You are a concise fitness coach reviewing the user's week so far in the GymJam app.
Compare their current week to their 3-week rolling average. Focus on what they achieved.
Celebrate improvements, note any declines matter-of-factly, and end with one brief insight.
Keep it to 2-3 sentences, conversational tone, no emojis. This is about results, not instructions.

This week: ${current.workouts} workouts, ${Math.round(current.volumeKg)} kg volume, ${current.avgDurationMinutes ?? 0} min avg duration, ${current.totalCalories} kcal burned
Previous 3-week average: ${prev.workouts.toFixed(1)} workouts/week, ${Math.round(prev.volumeKg)} kg, ${Math.round(prev.avgDurationMinutes)} min, ${Math.round(prev.totalCalories)} kcal`;
    } else {
      prompt = `You are a concise fitness coach reviewing the user's week so far in the GymJam app.
The user doesn't have enough history for comparison yet. Briefly summarize their current week stats.
Keep it to 1-2 sentences, conversational tone, no emojis.

This week: ${current.workouts} workouts, ${Math.round(current.volumeKg)} kg volume, ${current.avgDurationMinutes ?? 0} min avg duration, ${current.totalCalories} kcal burned`;
    }

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate the weekly overview.' },
      ],
      max_tokens: 200,
      temperature: 0.6,
    });

    if (response.usage) {
      this.aiUsage.trackUsage({
        userId,
        feature: 'weekly_overview',
        model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
      });
    }

    const overview = response.choices[0]?.message?.content?.trim();
    if (!overview) throw new Error('Empty OpenAI response');

    await this.prisma.weeklyOverview.upsert({
      where: { user_id_week_start: { user_id: userId, week_start: weekStart } },
      create: { user_id: userId, week_start: weekStart, overview },
      update: { overview },
    });

    return overview;
  }

  private generateFallbackOverview(
    current: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number | null;
      totalCalories: number;
    },
    prev: {
      workouts: number;
      volumeKg: number;
      avgDurationMinutes: number;
      totalCalories: number;
    } | null,
  ): string {
    const parts = [
      `${current.workouts} workout${current.workouts === 1 ? '' : 's'} this week`,
      `${Math.round(current.volumeKg).toLocaleString()} kg total volume`,
    ];
    if (!prev) {
      return `${parts.join(', ')}. Not enough history for comparison yet.`;
    }
    return `${parts.join(', ')}. Previous 3-week average: ${prev.workouts.toFixed(1)} workouts, ${Math.round(prev.volumeKg).toLocaleString()} kg volume.`;
  }

  // ── Quick Workout ──────────────────────────────────────

  async generateQuickWorkout(userId: string) {
    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    if (!onboarding) return null;

    try {
      return await this.generateAISession(userId, onboarding);
    } catch (error) {
      console.error(
        'AI session generation failed, falling back to round-robin:',
        error,
      );
      return this.generateFallbackSession(userId, onboarding);
    }
  }

  private async generateAISession(userId: string, onboarding: any) {
    const allowedEquipment = EQUIPMENT_MAP[onboarding.available_equipment];
    const equipmentFilter =
      allowedEquipment && allowedEquipment.length > 0
        ? { equipment: { in: allowedEquipment } }
        : {};

    const [allExercises, recentSessions, weekStats] = await Promise.all([
      this.prisma.exerciseLibrary.findMany({
        where: {
          OR: [{ is_system: true }, { user_id: userId }],
          ...equipmentFilter,
        },
        orderBy: { name: 'asc' },
      }),
      this.getRecentSessions(userId, 14),
      this.getWeekStats(userId),
    ]);

    if (allExercises.length === 0) return null;

    // Pre-filter: pick target muscle groups and limit exercises per group
    const targetMuscleGroups = this.pickTargetMuscleGroups(recentSessions);
    const filtered =
      targetMuscleGroups.length > 0
        ? allExercises.filter((e) =>
            targetMuscleGroups.includes(e.muscle_group),
          )
        : allExercises;
    const exercises = this.limitExercisesPerGroup(
      filtered.length > 0 ? filtered : allExercises,
      10,
    );

    const systemPrompt = this.buildSessionPrompt(
      onboarding,
      exercises,
      recentSessions,
      weekStats,
    );

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: "Generate today's workout session.",
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.7,
    });

    if (response.usage) {
      this.aiUsage.trackUsage({
        userId,
        feature: 'quick_workout',
        model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
      });
    }

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty OpenAI response');

    const parsed = JSON.parse(content) as {
      title: string;
      type: string;
      exercises: {
        library_exercise_id: string;
        name: string;
        muscle_group: string;
        sets_display: string;
      }[];
      ai_message: string;
    };

    // Validate exercise IDs against the library
    const exerciseMap = new Map(exercises.map((e) => [e.id, e]));
    const validExercises = parsed.exercises.filter((e) =>
      exerciseMap.has(e.library_exercise_id),
    );

    if (validExercises.length === 0) {
      throw new Error('AI returned no valid exercises');
    }

    // Suggest weights for each exercise
    const weightMap = await this.weightSuggestionService.suggestWeights(
      userId,
      validExercises.map((ex) => {
        const libEx = exerciseMap.get(ex.library_exercise_id)!;
        return {
          library_exercise_id: ex.library_exercise_id,
          muscle_group: libEx.muscle_group,
          equipment: libEx.equipment,
        };
      }),
      onboarding,
    );

    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: parsed.title || "Today's Session",
        type: parsed.type || 'strength',
        status: 'proposed',
        duration_minutes: onboarding.workout_duration,
        ai_generated: true,
        ai_message: parsed.ai_message || 'A workout tailored just for you!',
        updated_at: new Date(),
        exercises: {
          create: validExercises.map((ex, i) => {
            const libEx = exerciseMap.get(ex.library_exercise_id)!;
            return {
              library_exercise_id: ex.library_exercise_id,
              external_id: libEx.external_id ?? null,
              name: libEx.name,
              muscle_group: libEx.muscle_group,
              equipment: libEx.equipment,
              step_number: i + 1,
              sets_display: ex.sets_display || '3 × 10',
              accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
              suggested_weight: weightMap.get(ex.library_exercise_id) ?? null,
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

  private buildSessionPrompt(
    onboarding: any,
    exercises: any[],
    recentSessions: any[],
    weekStats: {
      completedThisWeek: number;
      targetPerWeek: number;
      daysLeftInWeek: number;
    },
  ): string {
    const exerciseList = exercises
      .map(
        (e) =>
          `- ${e.name} (id: ${e.id}, muscle: ${e.muscle_group}, equipment: ${e.equipment})`,
      )
      .join('\n');

    const sessionsContext = formatRecentSessions(recentSessions);

    return `You are a fitness coach AI for the GymJam app.
Create a workout session for this user by selecting exercises from their available exercise library.

User profile:
- Goal: ${onboarding.primary_goals?.[0]}
- Sport: ${onboarding.primary_sports?.[0]}
- Experience: ${onboarding.experience_level}
- Training frequency target: ${onboarding.training_frequency}x per week
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}${aiContextLine(onboarding)}

Week progress: ${weekStats.completedThisWeek}/${weekStats.targetPerWeek} workouts completed, ${weekStats.daysLeftInWeek} days left in the week.

${sessionsContext}

Available exercises (ONLY pick from this list using the exact id):
${exerciseList}

Respond with a JSON object:
{
  "title": "Session title (e.g. 'Upper Body Power', 'Full Body Burn')",
  "type": "strength",
  "exercises": [
    {
      "library_exercise_id": "exact-uuid-from-list",
      "name": "Exercise Name",
      "muscle_group": "Muscle Group",
      "sets_display": "3 × 10"
    }
  ],
  "ai_message": "Short explanation of why you chose this workout (1-2 sentences)"
}

Rules:
- Pick 4-6 exercises
- Vary muscle groups for a balanced session
- Avoid exercises that would aggravate listed injuries
- Match rep scheme to the user's goal:
  * build_muscle: 3×10 or 4×8
  * lose_fat: 3×12-15
  * get_stronger: 4×6 or 5×5
  * improve_endurance: 3×15-20
  * stay_healthy: 3×10-12
- Avoid repeating the exact same workout from recent sessions
- ONLY use library_exercise_id values from the available exercises list above
- The ai_message should feel personal and explain the workout choice`;
  }

  private async generateFallbackSession(userId: string, onboarding: any) {
    const allowedEquipment = EQUIPMENT_MAP[onboarding.available_equipment];
    const equipmentFilter =
      allowedEquipment && allowedEquipment.length > 0
        ? { equipment: { in: allowedEquipment } }
        : {};

    const allExercises = await this.prisma.exerciseLibrary.findMany({
      where: {
        OR: [{ is_system: true }, { user_id: userId }],
        ...equipmentFilter,
      },
      orderBy: { name: 'asc' },
    });

    if (allExercises.length === 0) return null;

    const exercises = this.limitExercisesPerGroup(allExercises, 10);

    const targetCount = Math.min(6, Math.max(4, exercises.length));
    const byMuscle = new Map<string, typeof exercises>();
    for (const ex of exercises) {
      const group = byMuscle.get(ex.muscle_group) ?? [];
      group.push(ex);
      byMuscle.set(ex.muscle_group, group);
    }

    const muscleGroups = [...byMuscle.keys()];
    const picked: typeof exercises = [];
    let mgIndex = 0;

    while (picked.length < targetCount && picked.length < exercises.length) {
      const mg = muscleGroups[mgIndex % muscleGroups.length];
      const available = byMuscle.get(mg)!;
      const unused = available.filter(
        (e) => !picked.some((p) => p.id === e.id),
      );
      if (unused.length > 0) {
        const dayOfYear = Math.floor(
          (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
            86400000,
        );
        const idx = (dayOfYear + mgIndex) % unused.length;
        picked.push(unused[idx]);
      }
      mgIndex++;
      if (mgIndex - picked.length > muscleGroups.length) break;
    }

    const setsDisplay =
      SETS_DISPLAY_BY_GOAL[onboarding.primary_goals?.[0] ?? ''] ?? '3 × 10';

    // Suggest weights for picked exercises
    const weightMap = await this.weightSuggestionService.suggestWeights(
      userId,
      picked.map((ex) => ({
        library_exercise_id: ex.id,
        muscle_group: ex.muscle_group,
        equipment: ex.equipment,
      })),
      onboarding,
    );

    const goalLabels: Record<string, string> = {
      build_muscle: 'muscle building',
      lose_fat: 'fat loss',
      get_stronger: 'strength',
      improve_endurance: 'endurance',
      stay_healthy: 'general fitness',
    };
    const goalLabel =
      goalLabels[onboarding.primary_goals?.[0] ?? ''] || 'fitness';

    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: "Today's Session",
        type: 'strength',
        status: 'proposed',
        duration_minutes: onboarding.workout_duration,
        ai_generated: true,
        ai_message: `I built a balanced ${goalLabel} session based on your profile and available equipment. Let's go!`,
        updated_at: new Date(),
        exercises: {
          create: picked.map((ex, i) => ({
            library_exercise_id: ex.id,
            external_id: ex.external_id ?? null,
            name: ex.name,
            muscle_group: ex.muscle_group,
            equipment: ex.equipment,
            step_number: i + 1,
            sets_display: setsDisplay,
            accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
            suggested_weight: weightMap.get(ex.id) ?? null,
          })),
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

  // ── Exercise Pre-filtering ──────────────────────────────────

  private pickTargetMuscleGroups(recentSessions: any[]): string[] {
    const allGroups = [
      'Chest',
      'Back',
      'Legs',
      'Shoulders',
      'Arms',
      'Core',
      'Other',
    ];

    if (recentSessions.length === 0) return [];

    // Count how often each muscle group appeared in recent sessions
    const counts = new Map<string, number>();
    for (const mg of allGroups) counts.set(mg, 0);
    for (const session of recentSessions) {
      for (const ex of session.exercises ?? []) {
        if (ex.muscle_group) {
          counts.set(ex.muscle_group, (counts.get(ex.muscle_group) ?? 0) + 1);
        }
      }
    }

    // Sort by least-trained first, pick 3-4 groups
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
    return sorted.slice(0, 4).map(([mg]) => mg);
  }

  private limitExercisesPerGroup(exercises: any[], maxPerGroup: number): any[] {
    const groups = new Map<string, any[]>();
    for (const ex of exercises) {
      const g = groups.get(ex.muscle_group) ?? [];
      g.push(ex);
      groups.set(ex.muscle_group, g);
    }
    const result: any[] = [];
    for (const [, group] of groups) {
      // Compound exercises first, then isolation
      group.sort(
        (a, b) =>
          (a.mechanic === 'compound' ? -1 : 1) -
          (b.mechanic === 'compound' ? -1 : 1),
      );
      result.push(...group.slice(0, maxPerGroup));
    }
    return result;
  }

  // ── Shared Helpers ────────────────────────────────────────

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
    const weekStart = getWeekStart(now);
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

  private endOfDay(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }
}
