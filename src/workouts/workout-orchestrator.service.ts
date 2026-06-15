import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  getWeekStartInTz,
  toMondayDowInTz,
  userLocalDayBoundsUtc,
} from '../common/date-utils';

/**
 * Cross-cutting workout lifecycle coordinator. Owns post-completion side
 * effects (cache invalidation, plan-day linkage, AI completion notes,
 * analytics, reminders) and ad-hoc-session ↔ plan-day reconciliation.
 *
 * Replaces three previously scattered code paths:
 *   - HomeService.postCompletionEffects body (cache + PlanDay + reminders)
 *   - CoachToolsService.linkSessionToTodayAndRebalance (private)
 *   - PlansService.adaptSkippedDays recovery block (Phase 2 finishes that)
 *
 * Lives in a @Global() module so HomeModule and CoachModule don't have
 * to import WorkoutsModule explicitly — that avoids the
 * `HomeModule → WorkoutsModule → PlansModule → HomeModule` cycle that
 * would otherwise emerge from the existing PlansModule → HomeModule
 * dependency (for WeightSuggestionService).
 */
@Injectable()
export class WorkoutOrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: PlansService injects this orchestrator (lazy fallback
    // in adaptSkippedDays). Both sides resolve via forwardRef.
    @Inject(forwardRef(() => PlansService))
    private readonly plansService: PlansService,
    private readonly analytics: AnalyticsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Resolve the user's IANA timezone (e.g. "Europe/Bucharest"). Stored
   * by the push-token registration flow. Returns null if the user
   * hasn't registered a device yet — callers fall back to server-local
   * behavior in that case.
   */
  private async getUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? null;
  }

  /**
   * Canonical post-completion hook. Called by every code path that
   * transitions a `WorkoutSession.status` to `'completed'`.
   *
   * Order matters: cache invalidation first (so the next dashboard
   * fetch sees a clean slate), then reconciliation (so the plan
   * reflects this session before any AI completion notes reason about
   * it), then the plan-domain hook (PlanDay status + AI notes), then
   * analytics, then reminder recalc.
   */
  async recordCompletion(
    userId: string,
    sessionId: string,
    metrics: {
      durationMinutes: number | null;
      calories: number | null;
      effortLevel?: number;
    },
  ): Promise<void> {
    // 1. Invalidate motivation + weekly overview caches so the next
    // dashboard load regenerates them with this session included.
    await this.prisma.motivationInsight.deleteMany({
      where: { user_id: userId },
    });
    const tz = await this.getUserTimezone(userId);
    const weekStart = getWeekStartInTz(new Date(), tz);
    await this.prisma.weeklyOverview.deleteMany({
      where: { user_id: userId, week_start: weekStart },
    });

    // 2. Reconcile against ad-hoc sessions — if this session happened
    // on a past pending plan day's calendar date, mark that plan day
    // completed and link the session.
    await this.reconcileWithAdHocSessions(userId);

    // 2b. Adaptive plan: if the linked plan day expected a different
    // set of muscle groups than what the user actually trained,
    // overwrite the plan day's content with reality. Runs BEFORE
    // onSessionCompleted so the AI completion notes reason about the
    // actual session rather than the stale planned content.
    await this.adaptPlanDayToActualSession(sessionId);

    // 3. Plan-domain completion hook: marks PlanDay completed and
    // generates AI completion notes when the session is linked to a
    // plan day. No-op for unlinked sessions.
    await this.plansService.onSessionCompleted(sessionId);

    // 4. Eagerly redistribute any unfulfilled muscle groups from
    // truly-skipped past days across the rest of the week. Previously
    // only ran lazily on the next getActivePlan fetch (Phase 2 makes
    // it reactive to completions too).
    await this.redistributeAfterCompletion(userId);

    // 5. Analytics.
    this.analytics.track(userId, 'session_completed', {
      duration_minutes: metrics.durationMinutes,
      calories: metrics.calories,
      effort_level: metrics.effortLevel ?? null,
    });

    // 6. Reminder recalc (fire-and-forget — slow notification math
    // shouldn't fail a completion).
    this.notificationsService
      .recalculatePreferredHour(userId)
      .catch(() => {});
  }

  /**
   * Ensure the user's active plan covers the current week. If
   * `now >= plan.week_start_date + 7d`, deactivate the stale plan
   * and generate a fresh one.
   *
   * Lives here (not on PlansService) because:
   *  1. We need to call it from /home/dashboard too — iOS reads
   *     plan_days off the dashboard payload, so a check that only
   *     runs in /api/v1/plans (getActivePlan) misses every cold
   *     dashboard load. A user returning to the app after a week
   *     would see last week's plan until they manually regenerated.
   *  2. PlansService can't be cleanly imported into HomeService
   *     (HomeModule is imported BY PlansModule for WeightSuggestion);
   *     the orchestrator already injects PlansService via
   *     forwardRef, so this is the natural seam.
   *
   * Bypasses the premium gate that applies to user-initiated regens.
   * A natural week rollover is a system operation — pay-walling it
   * would leave non-premium users stuck on a stale plan with no
   * recourse, which is broken UX regardless of subscription tier.
   *
   * Idempotent: a second call on an already-current plan no-ops.
   * Wrap in catch at the call site if a generation failure shouldn't
   * fail the request that triggered the check.
   */
  async ensureCurrentWeek(userId: string): Promise<void> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      select: { id: true, week_start_date: true },
    });
    if (!plan) return;
    const weekEnd = new Date(
      plan.week_start_date.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    if (new Date() < weekEnd) return;

    // Mirror what generatePlan(force=true) does to clear the slate —
    // null out workout_session_id FKs on the old plan's days, then
    // mark the plan inactive so the existing-active-plan check in
    // generatePlan(force=false) doesn't early-return.
    await this.prisma.planDay.updateMany({
      where: { plan_id: plan.id, workout_session_id: { not: null } },
      data: { workout_session_id: null },
    });
    await this.prisma.trainingPlan.update({
      where: { id: plan.id },
      data: { is_active: false },
    });

    // force=false so the premium check in generatePlan stays out of
    // the way. The deactivation above means generation proceeds
    // without the "Plan already exists" early-return.
    await this.plansService.generatePlan(userId, false);
  }

  /**
   * Helper: fetch the active plan + onboarding and ask PlansService to
   * redistribute any muscle-group deficit from truly-skipped past days
   * (i.e. past pending training days with no completed session that
   * calendar date) into the remaining pending days. Idempotent — guards
   * by adapted_at on the plan side.
   */
  private async redistributeAfterCompletion(userId: string): Promise<void> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });
    if (!plan) return;
    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });
    const tz = await this.getUserTimezone(userId);
    const todayDow = toMondayDowInTz(new Date(), tz);
    await this.plansService.redistributeDeficit(
      plan,
      todayDow,
      userId,
      onboarding,
    );
  }

  /**
   * Adaptive plan hook. When a completed session is linked to a plan
   * day, compare the muscle groups actually trained against the muscle
   * groups the plan day expected. If they differ as sets, overwrite
   * the plan day's content with the actual session — the original
   * planned exercises are dropped (no redistribution to future days).
   *
   * Same-set deviations (e.g. user swapped one chest exercise for
   * another but still hit Chest/Shoulders/Arms) are left alone — the
   * plan day's planned content stays, the session_id link is enough
   * for UIs that want to render what was actually done.
   *
   * Idempotent: a second call after content has already been adapted
   * is a no-op because the muscle sets will then match.
   */
  private async adaptPlanDayToActualSession(sessionId: string): Promise<void> {
    const planDay = await this.prisma.planDay.findFirst({
      where: { workout_session_id: sessionId },
    });
    if (!planDay) return;

    const session = await this.prisma.workoutSession.findUnique({
      where: { id: sessionId },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          // Same reason as linkSessionToToday — keep per-set targets
          // attached so the plan day reflects what the user actually
          // did, weights and all.
          include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
        },
      },
    });
    if (!session) return;

    const actualMuscles = new Set(
      session.exercises
        .map((e: any) => e.muscle_group)
        .filter((m: string | null): m is string => !!m),
    );
    const plannedMuscles = new Set(planDay.muscle_groups);

    if (actualMuscles.size === plannedMuscles.size) {
      let equal = true;
      for (const m of actualMuscles) {
        if (!plannedMuscles.has(m)) {
          equal = false;
          break;
        }
      }
      if (equal) return;
    }

    const newExercisesJson = session.exercises.map((e: any) => ({
      library_exercise_id: e.library_exercise_id ?? null,
      external_id: e.external_id ?? null,
      name: e.name,
      muscle_group: e.muscle_group ?? null,
      equipment: e.equipment ?? null,
      sets_display: e.sets_display,
      target_sets: serializeExerciseSetsForJson(e.exercise_sets),
    }));

    await this.prisma.planDay.update({
      where: { id: planDay.id },
      data: {
        day_type: 'training',
        session_title: session.title,
        session_type: session.type,
        muscle_groups: [...actualMuscles],
        exercises_json: newExercisesJson,
        adapted_at: new Date(),
      },
    });
  }

  /**
   * Splice a freshly created session into the user's active plan:
   *   - Today's PlanDay adopts the session (title, exercises, muscle
   *     groups, workout_session_id, status='pending').
   *   - If today was originally a training day with content, those
   *     original exercises move to the next pending training day this
   *     week.
   * Silently no-ops when there's no active plan, today isn't in the
   * plan, or today's plan day is already completed.
   *
   * Lifted verbatim from `CoachToolsService.linkSessionToTodayAndRebalance`.
   */
  async linkSessionToToday(
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
    const tz = await this.getUserTimezone(userId);
    const todayDow = toMondayDowInTz(new Date(), tz);

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
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          // Include per-set targets so we can mirror them into the
          // plan day's exercises_json — without this, the dashboard /
          // plan tab lose the weights between app launches because
          // they read from exercises_json, not session_exercise rows.
          include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
        },
      },
    });
    if (!session) return { todayUpdated: false, movedToDayLabel: null };

    const originalDayType = todayDay.day_type;
    const originalTitle = todayDay.session_title;
    const originalSessionType = todayDay.session_type;
    const originalMuscleGroups = todayDay.muscle_groups;
    const originalExercises = todayDay.exercises_json;
    const originalIsTrainingWithContent =
      originalDayType === 'training' &&
      Array.isArray(originalExercises) &&
      (originalExercises as unknown[]).length > 0;

    const newExercisesJson = session.exercises.map((e: any) => ({
      library_exercise_id: e.library_exercise_id ?? null,
      external_id: e.external_id ?? null,
      name: e.name,
      muscle_group: e.muscle_group ?? null,
      equipment: e.equipment ?? null,
      sets_display: e.sets_display,
      target_sets: serializeExerciseSetsForJson(e.exercise_sets),
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
   * Scan past pending training days in the active plan. For any day
   * whose calendar date has a completed `WorkoutSession`, mark the
   * plan day completed and link the session.
   *
   * Mirrors the recovery block currently at `plans.service.ts:655-697`
   * inside `adaptSkippedDays`. Phase 2 will delete the duplicate and
   * have `getActivePlan` call this method first.
   *
   * Today-double-completion tiebreaker: if a plan day is already
   * linked to a completed session, skip it (the user's planned
   * workout wins; any extra ad-hoc session that day is bonus and
   * doesn't overwrite the link).
   */
  async reconcileWithAdHocSessions(
    userId: string,
  ): Promise<{ recoveredDayIds: string[] }> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      include: { days: { orderBy: { day_of_week: 'asc' } } },
    });
    if (!plan) return { recoveredDayIds: [] };

    const tz = await this.getUserTimezone(userId);
    const todayBounds = userLocalDayBoundsUtc(new Date(), tz);
    const todayDow = todayBounds.dow;
    // Include today: when the user regenerates a plan mid-week after
    // already completing today's session, we want today's training day
    // in the new plan to link to that completed session — otherwise
    // the user sees "do Pull Day" on Home for a workout they finished
    // an hour ago.
    //
    // Don't filter out days with `adapted_at` set: redistributeDeficit
    // stamps adapted_at when it promotes a rest day to training, and
    // those promoted days still need to be linked to a real completed
    // session afterward. Idempotency is enforced inside the loop via
    // the workout_session_id-already-pointing-at-a-completed-session
    // check, which is the actual "don't re-do work" signal.
    const skippedCandidates = plan.days.filter(
      (d) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week <= todayDow,
    );
    if (skippedCandidates.length === 0) return { recoveredDayIds: [] };

    // Anchor day-window math at the user's local midnight of TODAY,
    // then step backward by (todayDow - day_of_week) days. plan.week_start_date
    // is unreliable as an anchor: older plans were stamped against the
    // server's UTC midnight (off by hours from user-local Monday) and
    // newer plans get the user-tz Monday. Anchoring at "today in user
    // tz" is consistent for both.
    const userTodayStartMs = todayBounds.start.getTime();

    const recoveredDayIds: string[] = [];
    for (const day of skippedCandidates) {
      // If this plan day already points at a completed session, that
      // planned workout wins. Don't overwrite the link with whatever
      // ad-hoc session happened to also complete that day.
      if (day.workout_session_id) {
        const linked = await this.prisma.workoutSession.findUnique({
          where: { id: day.workout_session_id },
          select: { status: true },
        });
        if (linked?.status === 'completed') continue;
      }

      const dayOffset = day.day_of_week - todayDow;
      const dayStart = new Date(userTodayStartMs + dayOffset * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      // Filter out sessions that are already linked to another plan day
      // (e.g. the previous active plan claimed them before being
      // deactivated by a force-regen). PlanDay.workout_session_id is
      // @unique, so a naive update would fail with P2002. The
      // `plan_day: null` filter is on the relation back from
      // WorkoutSession.
      const completedThatDay = await this.prisma.workoutSession.findFirst({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: dayStart, lt: dayEnd },
          plan_day: null,
        },
        orderBy: { completed_at: 'asc' },
        select: { id: true },
      });
      if (!completedThatDay) continue;

      await this.prisma.planDay.update({
        where: { id: day.id },
        data: {
          status: 'completed',
          workout_session_id:
            day.workout_session_id ?? completedThatDay.id,
          adapted_at: new Date(),
        },
      });
      recoveredDayIds.push(day.id);
      this.analytics.track(userId, 'plan_day_recovered_from_session', {
        plan_id: plan.id,
        plan_day_id: day.id,
        session_id: completedThatDay.id,
        day_of_week: day.day_of_week,
      });
    }

    return { recoveredDayIds };
  }
}

/**
 * Project session_exercise.exercise_sets rows into the JSON shape we
 * persist on plan_day.exercises_json[i].target_sets. Mirrors what the
 * Coach create_workout_session tool stores so the dashboard
 * planned_workout / plan tab / chat history all read uniformly.
 *
 * Returns undefined when there are no sets so the JSON stays compact
 * and old rows (without target_sets) don't accidentally turn into an
 * empty array that iOS would still try to render.
 */
function serializeExerciseSetsForJson(
  sets: Array<{
    set_number: number;
    weight: any;
    weight_unit: string | null;
    reps: number;
    is_bodyweight: boolean | null;
  }> | null | undefined,
):
  | Array<{
      set_number: number;
      weight: number | null;
      weight_unit: string;
      reps: number;
      is_bodyweight: boolean;
    }>
  | undefined {
  if (!sets || sets.length === 0) return undefined;
  return sets.map((s) => ({
    set_number: s.set_number,
    weight:
      s.weight === null || s.weight === undefined
        ? null
        : typeof s.weight === 'string'
          ? Number(s.weight)
          : (s.weight as number),
    weight_unit: s.weight_unit ?? 'kg',
    reps: s.reps,
    is_bodyweight: s.is_bodyweight ?? false,
  }));
}
