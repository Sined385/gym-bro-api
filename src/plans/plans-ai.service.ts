import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../analytics/ai-usage.service';
import { aiContextLine } from '../common/ai-context';
import { summarizeAiError } from '../common/ai-error';
import {
  SkeletonDay,
  AiExerciseSelection,
  LibraryExercise,
} from './exercise-matcher';
import {
  formatRecentLiftsBlock,
  type RecentLift,
} from '../common/recent-lifts';

// Already-done days from the current calendar week that the new plan
// must absorb instead of treating as separate ad-hoc workouts. iOS
// builds this from completed workout_sessions whose completed_at lies
// in [weekStart, today].
export interface PlanWeekContext {
  completedDays: Array<{
    dayOfWeek: number; // 0=Monday..6=Sunday
    title: string;
    muscleGroups: string[]; // distinct groups hit, in display order
    topLifts: string[]; // 1-3 short summary lines, e.g. "Bench 100 kg × 3"
  }>;
}

@Injectable()
export class PlansAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
    private readonly aiUsage: AiUsageService,
  ) {}

  async generateWeeklyPlan(
    userId: string,
    onboarding: any,
    startDayOfWeek: number = 0,
    focus?: string,
    weekContext?: PlanWeekContext,
  ): Promise<SkeletonDay[]> {
    const dayNames = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const totalDays = 7 - startDayOfWeek;
    const scaledFrequency = Math.round(
      (onboarding.training_frequency || 3) * (totalDays / 7),
    );

    const focusBlock = focus
      ? `\nUser focus for this week: "${focus}". Treat the focus as the WEEK'S THEME — feature it on ONE primary training day (e.g. for "bench press" make ONE day a chest-led push day with a low-rep compound slot for that lift, sets like 4×5 or 5×5). Optionally include the focus muscle group as a single accessory slot on ONE other training day. The remaining training days MUST cover the OTHER muscle groups (Legs, Back/Pull, Shoulders, Arms, Core) for balance and recovery. DO NOT repeat the same primary lift across multiple days — three bench-press days in one week is wrong; a "bench press plan" is a balanced week that *features* bench press on its push day.\n`
      : '';

    const completedDays = weekContext?.completedDays ?? [];
    const completedBlock = completedDays.length > 0
      ? `\nUSER ALREADY TRAINED THIS WEEK:\n${completedDays
          .map((d) => {
            const lifts = d.topLifts.length > 0
              ? ` ${d.topLifts.join(', ')}.`
              : '';
            return `- ${dayNames[d.dayOfWeek]}: ${d.title} — ${d.muscleGroups.join(', ')}.${lifts}`;
          })
          .join('\n')}\n\nFor each of those days return a TRAINING entry with the SAME primary muscle groups the user actually hit. Do not relabel them as rest, do not propose a different focus for a day already trained — those days are FIXED. For the remaining days, structure the week so the user's frequency target (${onboarding.training_frequency}/week) is honored across the ALREADY-COMPLETED + ABOUT-TO-PLAN days combined. If the user already trained ${completedDays.length} day(s) this week, plan ${Math.max(0, (onboarding.training_frequency ?? 3) - completedDays.length)} additional training day(s).\n`
      : '';

    const prompt = `You are a fitness coach AI. Generate a ${totalDays}-day training plan skeleton from ${dayNames[startDayOfWeek]} through Sunday.

User profile:
- Goal: ${onboarding.primary_goals?.[0]}
- Sport: ${onboarding.primary_sports?.[0]}
- Experience: ${onboarding.experience_level}
- Training frequency: ${scaledFrequency} training days (scaled from ${onboarding.training_frequency}x/week for partial week)
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}${aiContextLine(onboarding)}
${focusBlock}${completedBlock}
Respond with a JSON object:
{
  "days": [
    {
      "day_of_week": ${startDayOfWeek},
      "day_type": "training",
      "session_title": "Upper Body Power",
      "session_type": "strength",
      "exercise_slots": [
        { "muscle_group": "Chest", "rep_scheme": "4 × 8", "focus": "compound" },
        { "muscle_group": "Back", "rep_scheme": "3 × 10", "focus": "isolation" }
      ]
    },
    {
      "day_of_week": ${startDayOfWeek + 1},
      "day_type": "rest",
      "exercise_slots": [],
      "alt_session": {
        "session_title": "Make-up Push Day",
        "session_type": "strength",
        "exercise_slots": [
          { "muscle_group": "Chest", "rep_scheme": "4 × 8", "focus": "compound" },
          { "muscle_group": "Shoulders", "rep_scheme": "3 × 10", "focus": "isolation" }
        ]
      }
    }
  ]
}

Rules:
- day_of_week: 0=Monday, 1=Tuesday, ..., 6=Sunday
- Exactly ${scaledFrequency} training days, rest are "rest" type
- Rest days: day_type="rest", empty exercise_slots
- Training days: 4-6 exercise_slots each, varied muscle groups across the week
- muscle_group MUST be one of: Chest, Back, Legs, Shoulders, Arms, Core
- focus: "compound" or "isolation" or null
- Match rep scheme to goal (build_muscle: 3-4×8-10, lose_fat: 3×12-15, get_stronger: 4-5×5-6, improve_endurance: 3×15-20, stay_healthy: 3×10-12)
- Avoid muscle groups that aggravate listed injuries
- Distribute training days evenly through the partial week
- BALANCE: across the week, cover at least three of {Chest/Push, Back/Pull, Legs} — never make the same muscle group the dominant group on more than ONE training day, even if the user named a specific lift.
- Return exactly ${totalDays} days (${startDayOfWeek} through 6)
- HARD REQUIREMENT: every training day MUST have between 4 and 6 entries in exercise_slots.

RECOVERY SPACING (apply after frequency is honored):
- Treat any days listed under "USER ALREADY TRAINED THIS WEEK" as FIXED ANCHORS.
- For the remaining training days, MAXIMIZE the gap between any two training days (completed or planned). Do NOT schedule two training days on consecutive calendar days unless frequency exceeds 4/week AND no non-consecutive placement is possible.
- New training days should bisect the longest gaps around the anchors, not cluster at the end of the week.
- Concretely (day_of_week is 0=Mon..6=Sun): if day 2 (Wed) is already completed and 2 more training days are needed across days 3-6 (Thu-Sun), pick days 4 + 6 (Fri + Sun, one-day gaps), NOT days 5 + 6 (Sat + Sun, back-to-back).

ANTICIPATORY ALT SESSIONS (for adaptation without re-calling AI):
- Every rest day MUST also include an "alt_session" — a full training session this rest day would become if an earlier training day in the week were skipped.
- Plan alts strategically across the week: an early-week rest day's alt should target the muscle groups most likely to be missed before it (e.g., Tuesday's alt makes sense as a Monday make-up); a mid-week rest day's alt covers Tue-Thu range; a late-week rest day's alt covers anything earlier.
- Alts should anchor balance: heavier compound work earlier in the week, lighter or hypertrophy work later.
- Alts MUST NOT duplicate the same primary lift used elsewhere in the week — even when they fire, the user's week should not become "5x bench press week".
- alt_session shape: { session_title, session_type, exercise_slots[] } — 3-5 exercise_slots per alt, same muscle_group/rep_scheme/focus shape as a training day.
- If the user has 0 training days (full rest week), alt_sessions are optional (week has nothing to make up).`;

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: 'Generate the weekly training plan skeleton.',
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        temperature: 0.7,
      });

      if (response.usage) {
        this.aiUsage.trackUsage({
          userId,
          feature: 'plan_generation',
          model,
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        });
      }

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty OpenAI response');

      const parsed = JSON.parse(content) as { days: SkeletonDay[] };
      return parsed.days;
    } catch (error) {
      console.warn(summarizeAiError('plan_generation', error));
      return this.generateFallbackPlan(onboarding, startDayOfWeek);
    }
  }

  generateFallbackPlan(
    onboarding: any,
    startDayOfWeek: number = 0,
  ): SkeletonDay[] {
    const totalDays = 7 - startDayOfWeek;
    const scaledFrequency = Math.round(
      ((onboarding.training_frequency || 3) * totalDays) / 7,
    );
    const days: SkeletonDay[] = [];

    const trainingDays = this.getTrainingDayIndices(
      scaledFrequency,
      startDayOfWeek,
    );

    const setsMap: Record<string, string> = {
      build_muscle: '3 × 10',
      lose_fat: '3 × 12',
      get_stronger: '4 × 6',
      improve_endurance: '3 × 15',
      stay_healthy: '3 × 10',
    };
    const repScheme = setsMap[onboarding.primary_goals?.[0] ?? ''] ?? '3 × 10';

    const sessionTemplates = [
      {
        title: 'Upper Body Power',
        type: 'strength',
        groups: ['Chest', 'Back', 'Shoulders'],
      },
      {
        title: 'Lower Body Strength',
        type: 'strength',
        groups: ['Legs', 'Legs', 'Core'],
      },
      {
        title: 'Push Day',
        type: 'strength',
        groups: ['Chest', 'Shoulders', 'Arms'],
      },
      {
        title: 'Pull Day',
        type: 'strength',
        groups: ['Back', 'Arms', 'Core'],
      },
      {
        title: 'Full Body',
        type: 'strength',
        groups: ['Chest', 'Back', 'Legs'],
      },
      {
        title: 'Upper Hypertrophy',
        type: 'strength',
        groups: ['Chest', 'Back', 'Shoulders'],
      },
      {
        title: 'Lower Hypertrophy',
        type: 'strength',
        groups: ['Legs', 'Legs', 'Core'],
      },
    ];

    let templateIdx = 0;
    for (let dow = startDayOfWeek; dow < 7; dow++) {
      if (trainingDays.includes(dow)) {
        const template =
          sessionTemplates[templateIdx % sessionTemplates.length];
        templateIdx++;

        // Build exercise slots: first per group = compound, rest = null
        const slots: {
          muscle_group: string;
          rep_scheme: string;
          focus: 'compound' | 'isolation' | null;
        }[] = [];
        const seenGroups = new Set<string>();
        for (const group of template.groups) {
          const focus = seenGroups.has(group) ? null : 'compound';
          seenGroups.add(group);
          slots.push({ muscle_group: group, rep_scheme: repScheme, focus });
        }
        // Pad to 5 slots by repeating groups
        let padIdx = 0;
        while (slots.length < 5) {
          const group = template.groups[padIdx % template.groups.length];
          slots.push({
            muscle_group: group,
            rep_scheme: repScheme,
            focus: 'isolation',
          });
          padIdx++;
        }

        days.push({
          day_of_week: dow,
          day_type: 'training',
          session_title: template.title,
          session_type: template.type,
          exercise_slots: slots,
        });
      } else {
        days.push({
          day_of_week: dow,
          day_type: 'rest',
          exercise_slots: [],
        });
      }
    }

    return days;
  }

  private getTrainingDayIndices(
    frequency: number,
    startDow: number = 0,
  ): number[] {
    const totalDays = 7 - startDow;
    const clamped = Math.min(Math.max(frequency, 0), totalDays);

    if (clamped === 0) return [];
    if (clamped === totalDays) {
      return Array.from({ length: totalDays }, (_, i) => startDow + i);
    }

    const indices: number[] = [];
    for (let i = 0; i < clamped; i++) {
      indices.push(
        startDow + Math.round((i * (totalDays - 1)) / (clamped - 1 || 1)),
      );
    }
    return [...new Set(indices)].sort((a, b) => a - b);
  }

  /**
   * Stage 3: AI picks specific exercises from curated candidate pools.
   * Returns null on failure (signals fallback to deterministic matcher).
   */
  async selectExercises(
    userId: string,
    skeleton: SkeletonDay[],
    candidatePools: Map<string, LibraryExercise[]>,
    onboarding: any,
    recentExerciseNames: string[],
    recentLifts: RecentLift[] = [],
    focus?: string,
  ): Promise<AiExerciseSelection | null> {
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    // Build pool descriptions: "id | name | mechanic | equipment"
    const poolLines: string[] = [];
    for (const [group, exercises] of candidatePools) {
      poolLines.push(`\n## ${group}`);
      for (const ex of exercises) {
        poolLines.push(
          `${ex.id} | ${ex.name} | ${ex.mechanic ?? 'n/a'} | ${ex.equipment}`,
        );
      }
    }

    // Build training day descriptions
    const trainingDays = skeleton.filter(
      (d) => d.day_type === 'training' && d.exercise_slots.length > 0,
    );
    const dayDescriptions = trainingDays.map((day) => {
      const slots = day.exercise_slots
        .map(
          (s, i) => `  Slot ${i + 1}: ${s.muscle_group} (${s.focus ?? 'any'})`,
        )
        .join('\n');
      return `Day ${day.day_of_week} — "${day.session_title}":\n${slots}`;
    });

    // Build alt-session descriptions: rest days that carry an alt
    // session for anticipatory adaptation.
    const altDays = skeleton.filter(
      (d) =>
        d.day_type === 'rest' &&
        d.alt_session &&
        d.alt_session.exercise_slots.length > 0,
    );
    const altDescriptions = altDays.map((day) => {
      const slots = day
        .alt_session!.exercise_slots.map(
          (s, i) => `  Slot ${i + 1}: ${s.muscle_group} (${s.focus ?? 'any'})`,
        )
        .join('\n');
      return `Alt for day ${day.day_of_week} — "${day.alt_session!.session_title}":\n${slots}`;
    });

    const recentLiftsBlock = formatRecentLiftsBlock(recentLifts);
    const focusLine = focus
      ? `\nUser focus for this plan: "${focus}". When the focus muscle group's primary day has an open slot for it, you MUST pick the canonical named lift if it's in that day's candidate pool (e.g. focus "bench press" → pick Barbell Bench Press for the chest compound slot on the push day). Any subsequent slot in that muscle group across the week picks a DIFFERENT exercise — don't repeat the same lift.`
      : '';

    const prompt = `You are a fitness coach. Pick the best exercises for each slot from the candidate pools below.

User profile:
- Goal: ${onboarding.primary_goals?.[0] ?? 'build_muscle'}
- Experience: ${onboarding.experience_level ?? 'intermediate'}
- Injuries: ${JSON.stringify(onboarding.injuries ?? [])}${aiContextLine(onboarding)}
- Recently used exercises (avoid repeating unless they're in "Your recent lifts" below — those are explicitly preferred for progression): ${recentExerciseNames.slice(0, 20).join(', ') || 'none'}
${focusLine}

Training days:
${dayDescriptions.join('\n\n')}

${altDescriptions.length > 0 ? `Alt sessions (for rest days that may be promoted on adaptation — pick exercises that work as make-ups for earlier training in the week):\n${altDescriptions.join('\n\n')}\n` : ''}
Candidate pools:
${poolLines.join('\n')}

${recentLiftsBlock}

PROGRESSIVE OVERLOAD (highest-priority rule):
For ANY slot where the candidate pool contains an exercise listed in "Your recent lifts" above, you MUST:
  1. Pick that exercise (use its library_exercise_id from the pool).
  2. Return target_sets that mirror the recorded ladder one-for-one, with the top working set bumped to the "suggest top set" value at the end of that recent-lifts line. Warm-up sets stay where they were.
Example — if Barbell Bench Press shows "last 2026-06-01: 50kg×10, 60kg×8, 80kg×6, 85kg×5, 85kg×5 — suggest top set 87.5kg × 5", the exercise entry for that slot is:
  { "library_exercise_id": "<bench id>", "name": "Barbell Bench Press - Medium Grip",
    "target_sets": [{"weight_kg":50,"reps":10},{"weight_kg":60,"reps":8},{"weight_kg":80,"reps":6},{"weight_kg":87.5,"reps":5},{"weight_kg":87.5,"reps":5}] }
For novel exercises (not in the recent-lifts block) target_sets is optional — omit it.

Rules:
- Pick EXACTLY one exercise per slot from the matching muscle group pool
- Prefer compound exercises for "compound" focus slots, isolation for "isolation" slots
- Avoid exercises that aggravate listed injuries
- Vary exercises across days (except where Progressive Overload mandates reusing a recent lift)
- Pick well-known, effective exercises over obscure ones
- You MUST only use exercise IDs from the pools above

Respond with JSON. Include "alts" only if alt sessions were listed above:
{
  "days": [
    {
      "day_of_week": <number>,
      "exercises": [
        { "library_exercise_id": "<uuid>", "name": "<exercise name>",
          "target_sets": [{"weight_kg":<number?>,"reps":<int>,"is_bodyweight":<bool?>}] }
      ]
    }
  ],
  "alts": [
    {
      "day_of_week": <rest day's day_of_week>,
      "exercises": [ ... same shape as days[].exercises ... ]
    }
  ]
}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: 'Select the best exercises for each training day.',
            },
          ],
          response_format: { type: 'json_object' },
          // Plans with rest-day alt sessions can push the per-day
          // exercise list past the prior cap; we were seeing JSON parse
          // failures at ~4 KB (truncated mid-string) in prod when the
          // AI's per-set target ladder hits a heavy bench/back/leg week
          // with several alts on top. 2500 leaves enough headroom for
          // the full per-set ladder on every slot + alt.
          max_tokens: 2500,
          temperature: 0.4,
        });

        if (response.usage) {
          this.aiUsage.trackUsage({
            userId,
            feature: 'exercise_selection',
            model,
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          });
        }

        const content = response.choices[0]?.message?.content;
        if (!content) continue;

        const parsed = JSON.parse(content) as AiExerciseSelection;

        // Validate
        if (!parsed.days || parsed.days.length !== trainingDays.length)
          continue;

        // Build set of all valid candidate IDs
        const validIds = new Set<string>();
        for (const exercises of candidatePools.values()) {
          for (const ex of exercises) validIds.add(ex.id);
        }

        let valid = true;
        for (let i = 0; i < trainingDays.length; i++) {
          const aiDay = parsed.days[i];
          const skelDay = trainingDays[i];

          // Check day_of_week matches
          if (aiDay.day_of_week !== skelDay.day_of_week) {
            valid = false;
            break;
          }

          // Check exercise count matches slot count
          if (aiDay.exercises.length !== skelDay.exercise_slots.length) {
            valid = false;
            break;
          }

          // Check all IDs exist in pool and no within-day duplicates
          const dayIds = new Set<string>();
          for (const ex of aiDay.exercises) {
            if (!validIds.has(ex.library_exercise_id)) {
              valid = false;
              break;
            }
            if (dayIds.has(ex.library_exercise_id)) {
              valid = false;
              break;
            }
            dayIds.add(ex.library_exercise_id);
          }
          if (!valid) break;
        }

        // Validate alts when present. Missing alts is acceptable — we
        // degrade gracefully (rest days get null alt_session_json,
        // adaptation logs a banner instead of promoting).
        if (valid && Array.isArray(parsed.alts) && parsed.alts.length > 0) {
          const altDayMap = new Map(altDays.map((d) => [d.day_of_week, d]));
          // Drop alts that don't match a known alt-day so they don't
          // poison the response; keep only validated entries.
          const cleanedAlts: AiExerciseSelection['alts'] = [];
          for (const aiAlt of parsed.alts) {
            const skelAlt = altDayMap.get(aiAlt.day_of_week);
            if (!skelAlt || !skelAlt.alt_session) continue;
            if (
              aiAlt.exercises.length !==
              skelAlt.alt_session.exercise_slots.length
            ) {
              continue;
            }
            const dayIds = new Set<string>();
            let altValid = true;
            for (const ex of aiAlt.exercises) {
              if (!validIds.has(ex.library_exercise_id)) {
                altValid = false;
                break;
              }
              if (dayIds.has(ex.library_exercise_id)) {
                altValid = false;
                break;
              }
              dayIds.add(ex.library_exercise_id);
            }
            if (altValid) cleanedAlts.push(aiAlt);
          }
          parsed.alts = cleanedAlts;
        }

        if (valid) return parsed;
      } catch (error) {
        console.warn(
          summarizeAiError(`exercise_selection_attempt_${attempt + 1}`, error),
        );
      }
    }

    // Both attempts failed — signal fallback
    return null;
  }

  async generateCompletionNotes(
    userId: string,
    planDay: any,
    session: any,
  ): Promise<string> {
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    try {
      const exerciseSummary = session.exercises
        .map((e: any) => {
          const sets = e.exercise_sets ?? [];
          if (sets.length === 0) return `- ${e.name}: no sets logged`;
          const setDetails = sets
            .map((s: any) => {
              const weight = s.weight
                ? `${Number(s.weight)} ${s.weight_unit}`
                : 'BW';
              return `${weight} × ${s.reps}`;
            })
            .join(', ');
          return `- ${e.name}: ${setDetails}`;
        })
        .join('\n');

      const duration = session.duration_minutes
        ? `${session.duration_minutes} min`
        : 'unknown';

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a strength coach. Summarize this workout session in 1-2 brief sentences for the "Gains & Notes" section of a training plan. Be direct, reference specific lifts or improvements. No cheerleading.`,
          },
          {
            role: 'user',
            content: `Session: "${planDay.session_title}" (${duration})\n${exerciseSummary}`,
          },
        ],
        max_tokens: 100,
        temperature: 0.6,
      });

      if (response.usage) {
        this.aiUsage.trackUsage({
          userId,
          feature: 'completion_notes',
          model,
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        });
      }

      return response.choices[0]?.message?.content ?? 'Session completed.';
    } catch {
      return 'Session completed successfully.';
    }
  }
}
