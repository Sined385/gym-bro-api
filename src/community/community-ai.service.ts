import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { summarizeAiError } from '../common/ai-error';

interface HistorySummary {
  totalSessions: number;
  avgSessionsPerWeek: number;
  avgSessionDurationMin: number;
  topMuscleGroups: string[];
  topExercises: {
    name: string;
    totalSets: number;
    avgWeight: number | null;
    maxWeight: number | null;
    avgReps: number;
  }[];
  weeklyVolume: number[];
  avgEffortLevel: number | null;
  volumeTrend: 'increasing' | 'stable' | 'decreasing';
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: any;
  expiresAt: number;
}

@Injectable()
export class CommunityAiService {
  private comparisonCache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
    private readonly aiUsage: AiUsageService,
  ) {}

  private getCacheKey(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  async compareUsers(currentUserId: string, otherUserId: string) {
    const cacheKey = this.getCacheKey(currentUserId, otherUserId);
    const cached = this.comparisonCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Swap users if needed so currentUser always reflects the requester
      if (cached.data.currentUser?.userId === currentUserId) {
        return cached.data;
      }
      return {
        ...cached.data,
        currentUser: cached.data.otherUser,
        otherUser: cached.data.currentUser,
      };
    }

    const emptyHistory: HistorySummary = {
      totalSessions: 0,
      avgSessionsPerWeek: 0,
      avgSessionDurationMin: 0,
      topMuscleGroups: [],
      topExercises: [],
      weeklyVolume: [],
      avgEffortLevel: null,
      volumeTrend: 'stable',
    };

    const [currentUserStats, otherUserStats] = await Promise.all([
      this.getUserLiftStats(currentUserId),
      this.getUserLiftStats(otherUserId),
    ]);

    let currentUserHistory = emptyHistory;
    let otherUserHistory = emptyHistory;

    try {
      [currentUserHistory, otherUserHistory] = await Promise.all([
        this.getUserHistorySummary(currentUserId),
        this.getUserHistorySummary(otherUserId),
      ]);
    } catch (error) {
      console.error('Failed to fetch workout history:', error);
    }

    const enrichedCurrentUser = {
      ...currentUserStats,
      totalSessions3mo: currentUserHistory.totalSessions,
      avgSessionsPerWeek: currentUserHistory.avgSessionsPerWeek,
      avgSessionDurationMin: currentUserHistory.avgSessionDurationMin,
      topMuscleGroups: currentUserHistory.topMuscleGroups,
      avgEffortLevel: currentUserHistory.avgEffortLevel,
      volumeTrend: currentUserHistory.volumeTrend,
    };

    const enrichedOtherUser = {
      ...otherUserStats,
      totalSessions3mo: otherUserHistory.totalSessions,
      avgSessionsPerWeek: otherUserHistory.avgSessionsPerWeek,
      avgSessionDurationMin: otherUserHistory.avgSessionDurationMin,
      topMuscleGroups: otherUserHistory.topMuscleGroups,
      avgEffortLevel: otherUserHistory.avgEffortLevel,
      volumeTrend: otherUserHistory.volumeTrend,
    };

    // Check if enough data
    const currentHasData =
      currentUserStats.benchPress ||
      currentUserStats.squat ||
      currentUserStats.deadlift ||
      currentUserHistory.totalSessions > 0;
    const otherHasData =
      otherUserStats.benchPress ||
      otherUserStats.squat ||
      otherUserStats.deadlift ||
      otherUserHistory.totalSessions > 0;

    if (!currentHasData && !otherHasData) {
      return {
        currentUser: enrichedCurrentUser,
        otherUser: enrichedOtherUser,
        overlapAnalysis:
          'Not enough workout data to generate a comparison. Both users need to log some workouts first.',
      };
    }

    try {
      const comparison = await this.generateComparison(
        currentUserId,
        enrichedCurrentUser,
        enrichedOtherUser,
        currentUserHistory,
        otherUserHistory,
      );
      const result = {
        currentUser: enrichedCurrentUser,
        otherUser: enrichedOtherUser,
        comparison,
        overlapAnalysis: comparison.summary,
      };
      this.comparisonCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return result;
    } catch (error) {
      console.warn(summarizeAiError('community_comparison', error));
      return {
        currentUser: enrichedCurrentUser,
        otherUser: enrichedOtherUser,
        overlapAnalysis:
          'Unable to generate comparison at this time. Check back later!',
      };
    }
  }

  private async getUserLiftStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    const keyLifts = ['Bench Press', 'Squat', 'Deadlift'];
    const liftStats: Record<string, number | null> = {};

    for (const lift of keyLifts) {
      const maxSet = await this.prisma.exerciseSet.findFirst({
        where: {
          exercise: {
            name: { contains: lift, mode: 'insensitive' },
            session: { user_id: userId },
          },
          weight: { not: null },
        },
        orderBy: { weight: 'desc' },
      });

      const key = lift.toLowerCase().replace(' ', '');
      liftStats[key] = maxSet?.weight ? Number(maxSet.weight) : null;
    }

    return {
      userId,
      fullName: user?.full_name ?? 'Unknown',
      benchPress: liftStats['benchpress'] ?? null,
      squat: liftStats['squat'] ?? null,
      deadlift: liftStats['deadlift'] ?? null,
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      experienceLevel: onboarding?.experience_level ?? null,
      primaryGoals: onboarding?.primary_goals ?? [],
    };
  }

  private async getUserHistorySummary(userId: string): Promise<HistorySummary> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const sessions = await this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: ninetyDaysAgo },
      },
      include: {
        exercises: {
          include: {
            exercise_sets: true,
          },
        },
        feedback: true,
      },
      orderBy: { completed_at: 'asc' },
    });

    const totalSessions = sessions.length;

    if (totalSessions === 0) {
      return {
        totalSessions: 0,
        avgSessionsPerWeek: 0,
        avgSessionDurationMin: 0,
        topMuscleGroups: [],
        topExercises: [],
        weeklyVolume: [],
        avgEffortLevel: null,
        volumeTrend: 'stable',
      };
    }

    // Avg sessions per week
    const weeksSpan = Math.max(1, 90 / 7);
    const avgSessionsPerWeek =
      Math.round((totalSessions / weeksSpan) * 10) / 10;

    // Avg session duration
    const durations = sessions
      .map((s) => s.duration_minutes)
      .filter((d): d is number => d != null);
    const avgSessionDurationMin =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Muscle group counts
    const muscleGroupCounts: Record<string, number> = {};
    // Exercise aggregation
    const exerciseMap: Record<
      string,
      { totalSets: number; weights: number[]; reps: number[] }
    > = {};

    // Weekly volume map (ISO week key)
    const weeklyVolumeMap: Record<string, number> = {};

    for (const session of sessions) {
      // Weekly volume key
      const completedAt = session.completed_at ?? session.created_at;
      const weekKey = this.getISOWeekKey(completedAt);

      for (const exercise of session.exercises) {
        // Muscle groups
        if (exercise.muscle_group) {
          const mg = exercise.muscle_group.toLowerCase();
          muscleGroupCounts[mg] =
            (muscleGroupCounts[mg] ?? 0) + exercise.exercise_sets.length;
        }

        // Exercise stats
        const exName = exercise.name.toLowerCase().trim();
        if (!exerciseMap[exName]) {
          exerciseMap[exName] = { totalSets: 0, weights: [], reps: [] };
        }
        const entry = exerciseMap[exName];

        for (const set of exercise.exercise_sets) {
          entry.totalSets++;
          if (set.weight != null) {
            entry.weights.push(Number(set.weight));
          }
          entry.reps.push(set.reps);

          // Weekly volume (weight * reps)
          if (set.weight != null) {
            const vol = Number(set.weight) * set.reps;
            weeklyVolumeMap[weekKey] = (weeklyVolumeMap[weekKey] ?? 0) + vol;
          }
        }
      }
    }

    // Top 3 muscle groups
    const topMuscleGroups = Object.entries(muscleGroupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([mg]) => mg);

    // Top 10 exercises by frequency (total sets)
    const topExercises = Object.entries(exerciseMap)
      .sort((a, b) => b[1].totalSets - a[1].totalSets)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        totalSets: data.totalSets,
        avgWeight:
          data.weights.length > 0
            ? Math.round(
                (data.weights.reduce((a, b) => a + b, 0) /
                  data.weights.length) *
                  10,
              ) / 10
            : null,
        maxWeight: data.weights.length > 0 ? Math.max(...data.weights) : null,
        avgReps:
          data.reps.length > 0
            ? Math.round(
                (data.reps.reduce((a, b) => a + b, 0) / data.reps.length) * 10,
              ) / 10
            : 0,
      }));

    // Weekly volume as sorted array
    const sortedWeeks = Object.keys(weeklyVolumeMap).sort();
    const weeklyVolume = sortedWeeks.map((k) => Math.round(weeklyVolumeMap[k]));

    // Avg effort level
    const efforts = sessions
      .map((s) => s.feedback?.effort_level)
      .filter((e): e is number => e != null);
    const avgEffortLevel =
      efforts.length > 0
        ? Math.round(
            (efforts.reduce((a, b) => a + b, 0) / efforts.length) * 10,
          ) / 10
        : null;

    // Volume trend: compare first 4 weeks avg vs last 4 weeks
    const volumeTrend = this.calculateVolumeTrend(weeklyVolume);

    return {
      totalSessions,
      avgSessionsPerWeek,
      avgSessionDurationMin,
      topMuscleGroups,
      topExercises,
      weeklyVolume,
      avgEffortLevel,
      volumeTrend,
    };
  }

  private getISOWeekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum =
      1 +
      Math.round(
        ((d.getTime() - week1.getTime()) / 86400000 -
          3 +
          ((week1.getDay() + 6) % 7)) /
          7,
      );
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  private calculateVolumeTrend(
    weeklyVolume: number[],
  ): 'increasing' | 'stable' | 'decreasing' {
    if (weeklyVolume.length < 4) return 'stable';

    const firstFour = weeklyVolume.slice(0, 4);
    const lastFour = weeklyVolume.slice(-4);

    const firstAvg = firstFour.reduce((a, b) => a + b, 0) / firstFour.length;
    const lastAvg = lastFour.reduce((a, b) => a + b, 0) / lastFour.length;

    if (firstAvg === 0) return lastAvg > 0 ? 'increasing' : 'stable';

    const changePercent = ((lastAvg - firstAvg) / firstAvg) * 100;

    if (changePercent > 10) return 'increasing';
    if (changePercent < -10) return 'decreasing';
    return 'stable';
  }

  private async generateComparison(
    userId: string,
    currentUser: any,
    otherUser: any,
    currentHistory: HistorySummary,
    otherHistory: HistorySummary,
  ) {
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    const systemPrompt = `You are a fitness comparison analyst for GymJam app. You will receive two users' training profiles including their key lift stats and 3-month workout history summaries.

Analyze and return a JSON object with these fields:
- "summary": A brief 2-3 sentence overall comparison highlighting the most interesting differences and similarities.
- "trainingPatterns": 2-3 sentences comparing training frequency, session duration, muscle group focus, and consistency.
- "volumeTrends": 2-3 sentences comparing volume trends over the past 3 months, noting who is progressing faster or maintaining better consistency.
- "strengths": An object with "currentUser" and "otherUser" keys, each a 1-2 sentence description of that user's standout strengths.
- "recommendation": 2-3 sentences of actionable advice for the current user based on the comparison.

Keep the tone encouraging, constructive, and specific. Reference actual numbers when relevant. Never be negative or discouraging.`;

    const formatExerciseList = (exercises: HistorySummary['topExercises']) =>
      exercises
        .slice(0, 5)
        .map(
          (e) =>
            `${e.name} (${e.totalSets} sets, avg ${e.avgWeight ?? '?'} kg, max ${e.maxWeight ?? '?'} kg, avg ${e.avgReps} reps)`,
        )
        .join('\n  ');

    const userPrompt = `Compare these two training profiles:

USER 1 (${currentUser.fullName}):
- Experience: ${currentUser.experienceLevel ?? 'Unknown'}
- Goal: ${currentUser.primaryGoals?.join(', ') || 'Unknown'}
- Body Weight: ${currentUser.bodyWeightKg ? currentUser.bodyWeightKg + ' kg' : 'Unknown'}
- Bench Press Max: ${currentUser.benchPress ? currentUser.benchPress + ' kg' : 'No data'}
- Squat Max: ${currentUser.squat ? currentUser.squat + ' kg' : 'No data'}
- Deadlift Max: ${currentUser.deadlift ? currentUser.deadlift + ' kg' : 'No data'}
- Sessions (3mo): ${currentHistory.totalSessions}, avg ${currentHistory.avgSessionsPerWeek}/week
- Avg Duration: ${currentHistory.avgSessionDurationMin} min
- Top Muscle Groups: ${currentHistory.topMuscleGroups.join(', ') || 'N/A'}
- Volume Trend: ${currentHistory.volumeTrend}
- Avg Effort: ${currentHistory.avgEffortLevel ?? 'N/A'}/10
- Top Exercises:
  ${formatExerciseList(currentHistory.topExercises) || 'No data'}

USER 2 (${otherUser.fullName}):
- Experience: ${otherUser.experienceLevel ?? 'Unknown'}
- Goal: ${otherUser.primaryGoals?.join(', ') || 'Unknown'}
- Body Weight: ${otherUser.bodyWeightKg ? otherUser.bodyWeightKg + ' kg' : 'Unknown'}
- Bench Press Max: ${otherUser.benchPress ? otherUser.benchPress + ' kg' : 'No data'}
- Squat Max: ${otherUser.squat ? otherUser.squat + ' kg' : 'No data'}
- Deadlift Max: ${otherUser.deadlift ? otherUser.deadlift + ' kg' : 'No data'}
- Sessions (3mo): ${otherHistory.totalSessions}, avg ${otherHistory.avgSessionsPerWeek}/week
- Avg Duration: ${otherHistory.avgSessionDurationMin} min
- Top Muscle Groups: ${otherHistory.topMuscleGroups.join(', ') || 'N/A'}
- Volume Trend: ${otherHistory.volumeTrend}
- Avg Effort: ${otherHistory.avgEffortLevel ?? 'N/A'}/10
- Top Exercises:
  ${formatExerciseList(otherHistory.topExercises) || 'No data'}

Return the analysis as a JSON object.`;

    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
      temperature: 0.7,
    });

    if (response.usage) {
      this.aiUsage.trackUsage({
        userId,
        feature: 'user_comparison',
        model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
      });
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(content);

    return {
      summary: parsed.summary ?? 'Unable to generate summary.',
      trainingPatterns: parsed.trainingPatterns ?? '',
      volumeTrends: parsed.volumeTrends ?? '',
      strengths: {
        currentUser: parsed.strengths?.currentUser ?? '',
        otherUser: parsed.strengths?.otherUser ?? '',
      },
      overlappingExercises: [],
      recommendation: parsed.recommendation ?? '',
    };
  }
}
