import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getWeekStartInTz, toMondayDowInTz } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { formatRecentSessions } from '../common/format-sessions';
import { aiContextLine } from '../common/ai-context';
import {
  computeRecentLifts as computeRecentLiftsShared,
  formatRecentLiftsBlock,
} from '../common/recent-lifts';
import {
  inferUserIntent,
  filterLibraryForContext,
  type UserIntent,
} from './prompt-intent';

@Injectable()
export class CoachPromptService {
  constructor(private readonly prisma: PrismaService) {}

  async getExerciseLibrary(userId: string) {
    // No equipment pre-filter — Coach sees the full catalog so it can honor
    // explicit user requests (e.g. "bench press") even when onboarding says
    // bodyweight-only. The equipment field is still attached to each entry
    // and used by the system prompt as a default-selection hint; user intent
    // in the current message overrides that hint per the priority chain in
    // buildSystemPrompt.
    return this.prisma.exerciseLibrary.findMany({
      where: {
        OR: [{ is_system: true }, { user_id: userId }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getRecentSessions(userId: string, days: number) {
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

  async getWeekStats(userId: string) {
    const now = new Date();
    const tzRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const weekStart = getWeekStartInTz(now, tzRow?.timezone ?? null);
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

  buildSystemPrompt(
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
    tz: string | null = null,
    latestUserMessage: string | null = null,
    thisWeekExercises: Array<{ name: string; muscleGroup: string | null }> = [],
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
- Injuries: ${JSON.stringify(onboarding.injuries)}${aiContextLine(onboarding)}`
      : 'No onboarding profile available.';

    const sessionsContext = formatRecentSessions(recentSessions);

    // One-line summary per exercise the user has performed recently,
    // with a server-computed "suggest" load for the top working set.
    // The AI uses this to drive progressive overload when reusing
    // familiar exercises — see the tool-usage rules below. Shared with
    // the plan-generation flow via common/recent-lifts.ts.
    const recentLifts = computeRecentLiftsShared(recentSessions);
    const recentLiftsBlock = formatRecentLiftsBlock(recentLifts);
    const recentLiftIds = recentLifts
      .map((l: any) => l.libraryExerciseId)
      .filter((id: string | null | undefined): id is string => !!id);

    // Intent-driven library filter. The user's current message decides
    // which slice of the catalog the AI sees this turn — focused
    // muscle/equipment slice when they're specific, balanced fallback
    // when they're vague. See `prompt-intent.ts` for the rules.
    const intent = inferUserIntent(latestUserMessage, exerciseLibrary);
    const filteredLibrary = filterLibraryForContext({
      library: exerciseLibrary,
      intent,
      onboarding,
      recentLiftIds,
      cap: 120,
    });
    const exerciseList =
      filteredLibrary.length > 0
        ? `Available exercises (use these library_exercise_id values when creating workouts — ${exerciseLibrary.length} total in library, ${filteredLibrary.length} surfaced this turn based on your message):\n${filteredLibrary
            .map(
              (e) =>
                `- ${e.name} (id: ${e.id}, muscle: ${e.muscle_group}, equipment: ${e.equipment})`,
            )
            .join('\n')}`
        : 'No exercise library available.';

    // Dedup signal: exercises the user already did THIS CALENDAR WEEK
    // (user-local Monday → now). The rule defers to direct user intent
    // so it doesn't block "repeat Monday's bench" — see the priority
    // block at the end of the prompt.
    const thisWeekBlock = formatThisWeekDedupBlock(thisWeekExercises);

    const currentSession = quickWorkout
      ? `Current quick workout: "${quickWorkout.title}" with ${quickWorkout.exercises.length} exercises: ${quickWorkout.exercises.map((e: any) => e.name).join(', ')}`
      : 'No current quick workout.';

    const dayFullNames = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const now = new Date();
    const todayDow = toMondayDowInTz(now, tz);
    // Format today in the user's tz, not UTC — otherwise late-night
    // sessions get tagged with yesterday's date in the prompt.
    const todayDate = tz
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(now)
      : now.toISOString().split('T')[0];

    let planContext = 'No active training plan.';
    if (activePlanData?.plan && activePlanData.days?.length > 0) {
      const weekNum = activePlanData.plan.weekNumber;
      const dayLines = activePlanData.days.map((d: any) => {
        const fullName = dayFullNames[d.dayOfWeek] ?? 'Day';
        const isToday = d.dayOfWeek === todayDow;
        const todayMarker = isToday ? ' ← TODAY' : '';
        if (d.dayType === 'rest') {
          return `- ${fullName} (day_of_week=${d.dayOfWeek}): Rest Day${todayMarker} — ${d.status}`;
        }
        const muscles = d.muscleGroups?.join(', ') ?? '';
        // Surface library_exercise_id so the AI can preserve identity
        // when modifying — modify_plan_days expects the full updated
        // exercise list, and reusing the id of unchanged entries
        // avoids re-resolving them server-side.
        const exercises = (d.exercises ?? [])
          .map(
            (e: any) =>
              `    • ${e.name} (${e.muscleGroup}, ${e.setsDisplay}${e.suggestedWeight ? `, ${e.suggestedWeight}kg` : ''}${e.libraryExerciseId ? `, lib_id: ${e.libraryExerciseId}` : ''})`,
          )
          .join('\n');
        const exerciseBlock = exercises ? `\n${exercises}` : '';
        return `- ${fullName} (day_of_week=${d.dayOfWeek}): ${d.sessionTitle ?? 'Training'} (${muscles})${todayMarker} — ${d.status}${exerciseBlock}`;
      });
      planContext = `Current training plan (Week ${weekNum}):\nDay mapping: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6\n${dayLines.join('\n')}`;
    }

    return `You are a no-nonsense strength coach for the GymJam app.
Today is ${dayFullNames[todayDow]} ${todayDate} (day_of_week=${todayDow}).
You have full context about the user's training. Help them with workout plans, exercise adjustments, and training advice.

Tool usage rules:
- "Build my plan" / "Create a weekly plan" / "Generate my training plan" → call generate_training_plan. This creates a full 7-day plan. Do NOT use create_workout_session for plan requests.
- "Create a workout" / "Build me a workout" / "Give me a workout for today" → call create_workout_session. Use this ONLY when there is no existing planned workout for the target day, or the user explicitly wants a brand new replacement.
- "Swap Tuesday to chest" / "Focus this week on arms" / "Make Friday a rest day" → call modify_plan_days. For changing the focus or day_type of existing plan days.
- "Add bicep curls to today" / "Swap deadlift for romanian deadlift" / "Drop the squats from Tuesday" / "Add another chest exercise" → call modify_plan_days for the affected day. Read the day's current exercises from the "Current training plan" block, apply the user's edit (insert / replace / remove), and pass the FULL UPDATED exercises list. The server replaces exercises_json wholesale, so any exercise you omit will be removed.
  - DO NOT use create_workout_session for this — that builds a fresh session from scratch and discards the user's original plan content.
  - When passing the unchanged exercises, reuse their library_exercise_id from the Current training plan block. Only generate new exercise entries for the additions / swaps.
- CRITICAL: When the user specifies a muscle group or focus (e.g. "arms", "back", "chest"), you MUST use exactly that focus in the tool call. Never substitute a different muscle group. If the user says "arms", the session titles, muscle groups, and exercises MUST target arms — not legs, not chest, not any other group.

HARD RULE — EVERY exercise you return in a tool call MUST use a library_exercise_id from the Available exercises list below. Do NOT invent exercises or pass entries without a library_exercise_id. The server will reject any free-form entry and you'll have to retry.

Title and message honesty:
- Workout title must reflect what is actually in the session. If you include bench press, "Bench Press Focus" is fine. If you don't, do not put "Bench Press" in the title.
- ai_message: be plain about what you built. No filler.

Plan integration (server auto-handles this):
- create_workout_session for today automatically replaces today's entry in the active plan with the new workout. Today's original training day (if any) is auto-shifted to the next pending training day this week.
- After the tool runs, the follow-up tool result includes "plan_today_updated" and "plan_displaced_to" (a day name like "Friday", or null). In the text reply you stream after the tool, briefly mention this if plan_today_updated is true — e.g. "Plugged it in as today; your original Pull Day moved to Friday." Keep it one sentence, no apology.

- Reference the training plan context above when user asks about their plan.
- When creating workouts, ALWAYS use the tool — never list exercises as plain text.
- For greetings, questions, advice, or general conversation — respond in text only. Do NOT call any tool unless the user explicitly asks for a workout, plan, or plan change.

Keep responses concise (2-3 sentences max for text replies).

${profile}

Week progress: ${weekStats.completedThisWeek}/${weekStats.targetPerWeek} workouts completed, ${weekStats.daysLeftInWeek} days left in the week.

${planContext}

${sessionsContext}

${currentSession}

${recentLiftsBlock}

PROGRESSIVE OVERLOAD (highest-priority workout-creation rule — read this before composing exercises):
For ANY exercise listed under "Your recent lifts" above, when you include it in a workout:
  1. REUSE the exercise — pass its library_exercise_id from the recent-lifts line.
  2. REQUIRED: pass target_sets that mirror the recorded ladder one-for-one, then bump the top working set to the "suggest top set" value at the end of that recent-lifts line. Warm-up sets stay where they were.
  3. REQUIRED: set sets_display to "<target_sets.length> × <top-set reps>" so the chat card pill reflects the actual ladder you're proposing.
Example — if a recent-lifts line says: "Barbell Bench Press (lib_id: abc) — last 2026-06-01: 50kg × 10, 60kg × 8, 80kg × 6, 85kg × 5, 85kg × 5 — suggest top set 87.5kg × 5", you MUST return for that exercise:
  library_exercise_id = "abc"
  sets_display = "5 × 5"
  target_sets = [{weight_kg:50,reps:10},{weight_kg:60,reps:8},{weight_kg:80,reps:6},{weight_kg:87.5,reps:5},{weight_kg:87.5,reps:5}]
NEVER return a generic "4 × 8" or "3 × 10" for an exercise that has load data — that throws away the user's progression. target_sets is optional only for novel exercises that don't appear in the recent-lifts block.

${exerciseList}

${thisWeekBlock}

Rules:
- Pick 4-6 exercises when creating workouts (fewer for short durations: 3-4 for ≤30 min)
- When the user requests a specific duration (e.g. "30 min workout"), pass that duration_minutes in the tool call and scale the exercise count accordingly
- Vary muscle groups for balanced sessions
- Avoid exercises that would aggravate listed injuries
- Match rep scheme to the user's goal
- ONLY use library_exercise_id values from the available exercises list above when creating workouts — never invent exercises or omit the id
- Be direct and concise — no cheerleading

## Priority — the user's current message is law
The user's message in THIS turn overrides every other signal above — onboarding equipment, personal context, recent lifts, the plan, the week-dedup list. Everything else is a hint; the user's direct ask is the order.

Concrete cases:
- If onboarding says "bodyweight" but the user asks for a "gym workout" / "barbell" / "machines", USE the gym library this turn. Ignore the onboarding equipment field entirely — the surfaced Available exercises list has already been filtered to honor the user's request.
- If the user names a specific exercise that's in the Available exercises list, use its library_exercise_id even if the equipment doesn't match onboarding (e.g. "do bench press today" while onboarding=bodyweight → use Barbell Bench Press).
- If the user says "I want to repeat Monday's bench" and bench is in the "already done this calendar week" block, include it anyway. The dedup rule is for unprompted choices, not direct requests.
- If the user names an exercise that ISN'T in the surfaced list, pick the closest sibling that IS in the list (e.g. "Sumo Deadlift" → "Conventional Deadlift"; "Pirate Squat" → "Goblet Squat" or "Barbell Back Squat") and briefly note the substitution in ai_message.

Fallback chain (only when the user's message gives no signal):
1. Personal context from the user (onboarding free-text field)
2. Onboarding profile (equipment, injuries, goal)
3. Recent lifts (for progression continuity)`;
  }
}

/**
 * Render the "you already did these this calendar week" block. The
 * inner rule is intentionally permissive — direct user requests still
 * win via the priority block at the end of the system prompt. This
 * just nudges the AI toward variations when the user hasn't asked for
 * a specific lift.
 */
function formatThisWeekDedupBlock(
  thisWeekExercises: Array<{ name: string; muscleGroup: string | null }>,
): string {
  if (!thisWeekExercises || thisWeekExercises.length === 0) {
    return '## This week so far\nNo workouts completed yet this calendar week.';
  }
  const lines = thisWeekExercises
    .map((e) => `- ${e.name}${e.muscleGroup ? ` (${e.muscleGroup})` : ''}`)
    .join('\n');
  return `## Already done this calendar week — vary unless asked
${lines}

Rule: If the user does NOT specifically ask for one of these, propose a variation instead (different angle, equipment, or grip). For example, if Bench Press is listed, prefer Incline Bench Press, Dumbbell Bench Press, or Decline Press. If the user names one of these directly, follow their request — see the priority block below.`;
}
