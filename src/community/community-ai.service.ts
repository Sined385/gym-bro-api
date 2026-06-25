import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { summarizeAiError } from '../common/ai-error';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface UserContext {
  fullName: string;
  experienceLevel: string | null;
  goals: string[];
  bodyWeightKg: number | null;
  sessionsPerWeek: number;
  topMuscleGroups: string[];
}

interface Metric {
  key: string;
  label: string;
  unit: string | null;
  currentValue: number;
  otherValue: number;
  higherIsBetter: boolean;
}

/// Builds the "You vs <name>" head-to-head. The comparable metrics are picked
/// dynamically from what the two users actually share (lifts by estimated 1RM
/// + shared activity stats); an AI analysis is then generated FROM those
/// metrics + each user's profile. Premium-gated — free users get `locked`.
@Injectable()
export class CommunityAiService {
  // Per-ordered-pair cache (the AI analysis is written from the viewer's POV).
  private cache = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
    private readonly aiUsage: AiUsageService,
    private readonly subscription: SubscriptionService,
  ) {}

  async compareUsers(currentUserId: string, otherUserId: string) {
    // Premium feature — free users get a teaser, no OpenAI call.
    if (!(await this.subscription.isPremium(currentUserId))) {
      return { locked: true };
    }

    const cacheKey = `${currentUserId}:${otherUserId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const [me, them] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: currentUserId } }),
      this.prisma.user.findUnique({ where: { id: otherUserId } }),
    ]);

    const metrics = await this.buildMetrics(currentUserId, otherUserId);

    const [myCtx, theirCtx] = await Promise.all([
      this.getUserContext(currentUserId, me?.full_name ?? 'You'),
      this.getUserContext(otherUserId, them?.full_name ?? 'Them'),
    ]);

    let analysis: any = null;
    const hasData = metrics.length > 0 || myCtx.sessionsPerWeek > 0;
    if (hasData) {
      try {
        analysis = await this.generateAnalysis(
          currentUserId,
          metrics,
          myCtx,
          theirCtx,
        );
      } catch (error) {
        console.warn(summarizeAiError('community_comparison', error));
      }
    }

    const result = {
      currentUser: { userId: currentUserId, fullName: myCtx.fullName },
      otherUser: { userId: otherUserId, fullName: theirCtx.fullName },
      metrics,
      analysis,
    };
    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  // MARK: dynamic metrics

  private async buildMetrics(
    currentUserId: string,
    otherUserId: string,
  ): Promise<Metric[]> {
    const [myLifts, theirLifts] = await Promise.all([
      this.getExerciseOneRepMaxes(currentUserId),
      this.getExerciseOneRepMaxes(otherUserId),
    ]);
    const theirMap = new Map(theirLifts.map((l) => [l.key, l]));

    const lifts: Metric[] = [];
    for (const lift of myLifts) {
      const other = theirMap.get(lift.key);
      if (!other) continue;
      lifts.push({
        key: `lift:${lift.key}`,
        label: lift.label,
        unit: 'kg',
        currentValue: lift.orm,
        otherValue: other.orm,
        higherIsBetter: true,
      });
    }
    lifts.sort(
      (a, b) => b.currentValue + b.otherValue - (a.currentValue + a.otherValue),
    );
    const topLifts = lifts.slice(0, 5);

    const extra: Metric[] = [];
    const [mySpw, theirSpw] = await Promise.all([
      this.getSessionsPerWeek(currentUserId),
      this.getSessionsPerWeek(otherUserId),
    ]);
    if (mySpw > 0 && theirSpw > 0) {
      extra.push({
        key: 'sessions_per_week',
        label: 'Sessions / wk',
        unit: null,
        currentValue: mySpw,
        otherValue: theirSpw,
        higherIsBetter: true,
      });
    }
    return [...topLifts, ...extra];
  }

  private async getExerciseOneRepMaxes(
    userId: string,
  ): Promise<{ key: string; label: string; orm: number }[]> {
    try {
      const rows = await this.prisma.$queryRaw<
        { key: string; label: string; orm: number | null }[]
      >`
        SELECT key, MIN(label) as label, ROUND(MAX(orm)) as orm
        FROM (
          SELECT
            lower(se.name) as key,
            se.name as label,
            (CASE WHEN es.weight_unit = 'lb' THEN es.weight * 0.453592 ELSE es.weight END)
              * (1 + LEAST(es.reps, 12) / 30.0) as orm
          FROM exercise_sets es
          JOIN session_exercises se ON se.id = es.exercise_id
          JOIN workout_sessions ws ON ws.id = se.session_id
          WHERE ws.user_id = ${userId}
            AND ws.status = 'completed'
            AND es.weight IS NOT NULL AND es.weight > 0 AND es.reps > 0
        ) t
        GROUP BY key
      `;
      return rows
        .filter((r) => r.orm != null && Number(r.orm) > 0)
        .map((r) => ({ key: r.key, label: r.label, orm: Number(r.orm) }));
    } catch {
      return [];
    }
  }

  private async getSessionsPerWeek(userId: string): Promise<number> {
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const count = await this.prisma.workoutSession.count({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: ninetyDaysAgo },
        },
      });
      return Math.round((count / (90 / 7)) * 10) / 10;
    } catch {
      return 0;
    }
  }

  private async getUserContext(
    userId: string,
    fullName: string,
  ): Promise<UserContext> {
    const [onboarding, sessionsPerWeek, topMuscleGroups] = await Promise.all([
      this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
      this.getSessionsPerWeek(userId),
      this.getTopMuscleGroups(userId),
    ]);
    return {
      fullName,
      experienceLevel: onboarding?.experience_level ?? null,
      goals: onboarding?.primary_goals ?? [],
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      sessionsPerWeek,
      topMuscleGroups,
    };
  }

  private async getTopMuscleGroups(userId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ mg: string }[]>`
        SELECT se.muscle_group as mg, COUNT(*) as c
        FROM session_exercises se
        JOIN workout_sessions ws ON ws.id = se.session_id
        JOIN exercise_sets es ON es.exercise_id = se.id
        WHERE ws.user_id = ${userId}
          AND ws.status = 'completed'
          AND se.muscle_group IS NOT NULL
        GROUP BY se.muscle_group
        ORDER BY c DESC
        LIMIT 3
      `;
      return rows.map((r) => r.mg).filter(Boolean);
    } catch {
      return [];
    }
  }

  // MARK: AI analysis

  private async generateAnalysis(
    userId: string,
    metrics: Metric[],
    me: UserContext,
    them: UserContext,
  ) {
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    const metricLines = metrics.length
      ? metrics
          .map(
            (m) =>
              `- ${m.label}: you ${m.currentValue}${m.unit ? ' ' + m.unit : ''} vs them ${m.otherValue}${m.unit ? ' ' + m.unit : ''}`,
          )
          .join('\n')
      : '(no directly shared lifts)';

    const profile = (c: UserContext) =>
      `experience=${c.experienceLevel ?? 'unknown'}, goals=${c.goals.join('/') || 'none'}, bodyweight=${c.bodyWeightKg ?? '?'}kg, sessions/wk=${c.sessionsPerWeek}, trains=${c.topMuscleGroups.join('/') || 'n/a'}`;

    const systemPrompt = `You are a fitness comparison analyst for the GymJam app. You compare the viewer ("you") with another lifter, using ONLY the data provided. Be specific, reference the actual numbers, and account for bodyweight differences when judging strength (lighter lifters moving similar weight are pound-for-pound stronger). Return a JSON object:
- "verdict": 2-3 sentence overall head-to-head read.
- "yourEdge": 1 sentence on where the viewer is ahead.
- "theirEdge": 1 sentence on where the other lifter is ahead.
- "takeaway": 1-2 sentences of actionable advice for the viewer.
Keep it punchy and encouraging, no markdown.`;

    const userPrompt = `Shared metrics (head-to-head):\n${metricLines}\n\nYou: ${profile(me)}\nThem (${them.fullName}): ${profile(them)}`;

    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.7,
    });

    void this.aiUsage.trackUsage({
      userId,
      feature: 'community_comparison',
      model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  }
}
