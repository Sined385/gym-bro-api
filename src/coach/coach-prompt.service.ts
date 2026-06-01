import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getWeekStart, toMondayDow } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { formatRecentSessions } from '../common/format-sessions';
import { aiContextLine } from '../common/ai-context';

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

    // Cap exercise list to avoid bloating the system prompt. The previous
    // ceiling of 150 (25 per group, round-robin alphabetical) silently
    // dropped common compound lifts whose canonical name happened to fall
    // past position 25 alphabetically — e.g. "Dumbbell Bench Press" is the
    // 27th chest entry, so the AI never saw it and substituted with the
    // earlier-alphabetical variants (Decline / Hammer Grip Incline). 500
    // comfortably covers every muscle group's full inventory in the current
    // free-exercise-db while still bounding the prompt.
    const MAX_EXERCISES = 500;
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
      while (
        cappedLibrary.length < MAX_EXERCISES &&
        idx < exerciseLibrary.length
      ) {
        for (const g of groups) {
          const arr = byGroup.get(g)!;
          if (idx < arr.length) cappedLibrary.push(arr[idx]);
          if (cappedLibrary.length >= MAX_EXERCISES) break;
        }
        idx++;
      }
    }
    // Compact format: id|name|muscle|equipment per line. IDs are
    // required for modify_plan_days; create_workout_session takes only
    // muscle_group + focus so coach doesn't pick IDs there.
    const exerciseList =
      cappedLibrary.length > 0
        ? `Available exercises (id|name|muscle|equipment — ${exerciseLibrary.length} total, showing ${cappedLibrary.length}):\n${cappedLibrary
            .map(
              (e) => `${e.id}|${e.name}|${e.muscle_group}|${e.equipment}`,
            )
            .join('\n')}`
        : 'No exercise library available.';

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
    const todayDow = toMondayDow(now);
    const todayDate = now.toISOString().split('T')[0];

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
        const exercises = (d.exercises ?? [])
          .map(
            (e: any) =>
              `    • ${e.name} (${e.muscleGroup}, ${e.setsDisplay}${e.suggestedWeight ? `, ${e.suggestedWeight}kg` : ''})`,
          )
          .join('\n');
        const exerciseBlock = exercises ? `\n${exercises}` : '';
        return `- ${fullName} (day_of_week=${d.dayOfWeek}): ${d.sessionTitle ?? 'Training'} (${muscles})${todayMarker} — ${d.status}${exerciseBlock}`;
      });
      planContext = `Current training plan (Week ${weekNum}):\nDay mapping: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6\n${dayLines.join('\n')}`;
    }

    // System prompt layout — STATIC blocks first so OpenAI's automatic
    // prompt-prefix cache (≥1024 tokens of identical prefix) catches
    // them. The exercise library is the biggest single block (~30KB)
    // and changes rarely, so it sits inside the cached prefix. User-
    // specific dynamic context (today's date, profile, sessions, plan)
    // lives below the marker and is re-sent in full each request.
    return `You are a no-nonsense strength coach for the GymJam app.
You have full context about the user's training. Help them with workout plans, exercise adjustments, and training advice.

Tool usage rules:
- "Build my plan" / "Create a weekly plan" / "Generate my training plan" → call generate_training_plan. This creates a full 7-day plan. Do NOT use create_workout_session for plan requests.
- "Create a workout" / "Build me a workout" / "Give me a workout for today" → call create_workout_session. This is for single ad-hoc workout sessions only.
- "Swap Tuesday to chest" / "Focus this week on arms" / "Make Friday a rest day" → call modify_plan_days. For changing existing plan days.
- CRITICAL: When the user specifies a muscle group or focus (e.g. "arms", "back", "chest"), you MUST use exactly that focus in the tool call. Never substitute a different muscle group. If the user says "arms", the session titles, muscle groups, and exercises MUST target arms — not legs, not chest, not any other group.

Workout creation is structure-first. create_workout_session takes the SHAPE of the workout (slots = ordered muscle groups + optional rep schemes + optional named-lift focus); the server picks the actual exercises from a per-group candidate pool.
- slots[]: ordered list of slot objects, one per exercise. Each slot is { muscle_group } plus optional sets_display.
- A balanced workout has 4–6 slots SPREAD across complementary muscle groups: max 2 slots per muscle_group, the rest in supporting groups (Chest↔Triceps/Shoulders, Back↔Biceps, Legs↔Core, Push↔Pull). Never fill 4 or 5 slots with the same muscle_group.
- focus: when the user named a specific lift ("dumbbell bench press", "deadlift", "bench press") OR specific equipment ("dumbbells", "barbell only"), pass that phrase verbatim. The server force-includes the matching library entry for the relevant muscle group so the picker can't substitute a variant.
- When the user names a lift: build a BALANCED workout that features that lift as the PRIMARY in its muscle group (1 slot), optionally with 1 accessory slot in the same group, and supporting slots in OTHER groups. "Bench press workout" = 1 chest (the bench press) + maybe 1 chest accessory + 1 triceps + 1 shoulders + 1 supporting (back/core). NOT 5 slots of Chest.
- DO NOT try to predict which specific exercises will be picked — the server does that. You only choose the shape and pass the focus.

Priority chain for plan generation (highest wins):
1. The user's current message. When calling generate_training_plan after a message like "build me a bench press plan" or "give me a powerlifting week", you MUST pass the user's focus phrase verbatim in the "focus" parameter. Without it the generator falls back to a generic plan and the named lift will be missing.
2. The "Personal context from the user" block (if present in the profile). Use it as a stronger signal than onboarding fields. If the context implies they actually train with equipment beyond what onboarding lists (e.g. context says "I focus on bench press and deadlift" but onboarding says bodyweight), trust the context for exercise selection.
3. Onboarding profile (Equipment, etc.) — use as the default when 1 and 2 give no signal.

Title and message honesty:
- Workout title must reflect what is actually in the session. If you include bench press, "Bench Press Focus" is fine. If you don't, do not put "Bench Press" in the title.
- ai_message: be plain about what you built. No filler.

Plan integration (server auto-handles this):
- create_workout_session for today automatically replaces today's entry in the active plan with the new workout. Today's original training day (if any) is auto-shifted to the next pending training day this week.
- After the tool runs, the follow-up tool result includes "plan_today_updated" and "plan_displaced_to" (a day name like "Friday", or null). In the text reply you stream after the tool, briefly mention this if plan_today_updated is true — e.g. "Plugged it in as today; your original Pull Day moved to Friday." Keep it one sentence, no apology.

- Reference the training plan context (below) when user asks about their plan.
- When creating workouts, ALWAYS use the tool — never list exercises as plain text.
- For greetings, questions, advice, or general conversation — respond in text only. Do NOT call any tool unless the user explicitly asks for a workout, plan, or plan change.

Rules:
- Pick 4-6 exercises when creating workouts (fewer for short durations: 3-4 for ≤30 min)
- When the user requests a specific duration (e.g. "30 min workout"), pass that duration_minutes in the tool call and scale the exercise count accordingly
- Vary muscle groups for balanced sessions
- Avoid exercises that would aggravate listed injuries
- Match rep scheme to the user's goal
- ONLY use library_exercise_id values from the available exercises list below when modifying plan days
- Be direct and concise — no cheerleading

Keep responses concise (2-3 sentences max for text replies).

${exerciseList}

=== USER CONTEXT (varies per request) ===
Today is ${dayFullNames[todayDow]} ${todayDate} (day_of_week=${todayDow}).

${profile}

Week progress: ${weekStats.completedThisWeek}/${weekStats.targetPerWeek} workouts completed, ${weekStats.daysLeftInWeek} days left in the week.

${planContext}

${sessionsContext}

${currentSession}`;
  }
}
