import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getWeekStart, toMondayDow } from '../common/date-utils';

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
    private readonly plansService: PlansService,
    private readonly analytics: AnalyticsService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
    const weekStart = getWeekStart(new Date());
    await this.prisma.weeklyOverview.deleteMany({
      where: { user_id: userId, week_start: weekStart },
    });

    // 2. Reconcile against ad-hoc sessions — if this session happened
    // on a past pending plan day's calendar date, mark that plan day
    // completed and link the session. Phase 1 keeps the parallel
    // recovery block in `adaptSkippedDays` for defence in depth; Phase
    // 2 will delete it.
    await this.reconcileWithAdHocSessions(userId);

    // 3. Plan-domain completion hook: marks PlanDay completed and
    // generates AI completion notes when the session is linked to a
    // plan day. No-op for unlinked sessions.
    await this.plansService.onSessionCompleted(sessionId);

    // 4. Analytics.
    this.analytics.track(userId, 'session_completed', {
      duration_minutes: metrics.durationMinutes,
      calories: metrics.calories,
      effort_level: metrics.effortLevel ?? null,
    });

    // 5. Reminder recalc (fire-and-forget — slow notification math
    // shouldn't fail a completion).
    this.notificationsService
      .recalculatePreferredHour(userId)
      .catch(() => {});
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

    const originalDayType = todayDay.day_type;
    const originalTitle = todayDay.session_title;
    const originalSessionType = todayDay.session_type;
    const originalMuscleGroups = todayDay.muscle_groups;
    const originalExercises = todayDay.exercises_json;
    const originalIsTrainingWithContent =
      originalDayType === 'training' &&
      Array.isArray(originalExercises) &&
      (originalExercises as unknown[]).length > 0;

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

    const todayDow = toMondayDow(new Date());
    const skippedCandidates = plan.days.filter(
      (d) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week < todayDow &&
        !d.adapted_at,
    );
    if (skippedCandidates.length === 0) return { recoveredDayIds: [] };

    const planWeekStart = new Date(plan.week_start_date);
    planWeekStart.setHours(0, 0, 0, 0);

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

      const dayStart = new Date(planWeekStart);
      dayStart.setDate(dayStart.getDate() + day.day_of_week);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const completedThatDay = await this.prisma.workoutSession.findFirst({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: dayStart, lt: dayEnd },
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
