import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  matchExercisesToSlots,
  normalizeMuscleGroup,
  ExerciseSlot,
} from './exercise-matcher';
import { toMondayDow } from '../common/date-utils';
import { EQUIPMENT_MAP } from '../common/equipment';
import { getRecentExerciseIds, getRepScheme } from './plan-helpers';
import { PlanGeneratorService } from './plan-generator.service';

@Injectable()
export class PlanAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly planGenerator: PlanGeneratorService,
  ) {}

  /**
   * Side-effect-only: ensures the user's active plan is up to date in the
   * database. Runs week auto-advance and skipped-day adaptation. Returns
   * nothing — callers refetch plan_days afterwards.
   *
   * Swallows PREMIUM_REQUIRED so a non-premium user with an expired week
   * still gets a dashboard rendered from whatever plan is in the DB.
   */
  async ensureCurrentPlan(userId: string): Promise<void> {
    try {
      await this.run(userId);
    } catch (err) {
      if ((err as any)?.code !== 'PREMIUM_REQUIRED') throw err;
    }
  }

  private async run(userId: string): Promise<void> {
    let plan = await this.loadPlan(userId);

    if (!plan) {
      // No plan — kick off generation in the background. Callers will see
      // an empty plan this turn; the next dashboard load picks it up.
      this.planGenerator.generatePlan(userId, false).catch(() => {});
      return;
    }

    // Auto-advance week if expired
    const now = new Date();
    const weekEnd = new Date(
      plan.week_start_date.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    if (now >= weekEnd) {
      await this.planGenerator.generatePlan(userId, true);
      plan = await this.loadPlan(userId);
      if (!plan) return;
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    const absoluteTodayDow = toMondayDow(now);
    await this.adaptSkippedDays(plan, absoluteTodayDow, userId, onboarding);
  }

  private loadPlan(userId: string) {
    return this.prisma.trainingPlan.findFirst({
      where: { user_id: userId, is_active: true },
      include: {
        days: {
          orderBy: { day_of_week: 'asc' },
          include: {
            workout_session: {
              select: {
                id: true,
                duration_minutes: true,
                completed_at: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Detects past pending training days, marks them as skipped, and
   * redistributes missed muscle groups across remaining days. Returns true
   * if any changes were made.
   */
  private async adaptSkippedDays(
    plan: any,
    todayDow: number,
    userId: string,
    onboarding: any | null,
  ): Promise<boolean> {
    // 1. Find skipped days — pending training days before today with no prior adaptation
    const skippedDays = plan.days.filter(
      (d: any) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week < todayDow &&
        !d.adapted_at,
    );

    // 2. Fast path — nothing to adapt
    if (skippedDays.length === 0) return false;

    // 3. Find future pending training days (after today)
    const futureDays = plan.days.filter(
      (d: any) =>
        d.status === 'pending' &&
        d.day_type === 'training' &&
        d.day_of_week > todayDow,
    );

    // Include today if it's a pending training day
    const todayDay = plan.days.find(
      (d: any) =>
        d.day_of_week === todayDow &&
        d.status === 'pending' &&
        d.day_type === 'training',
    );

    // 4. Collect missed muscle groups from skipped days
    const missedGroups: string[] = [];
    for (const day of skippedDays) {
      missedGroups.push(...(day.muscle_groups ?? []));
    }

    // 5. Collect already-planned muscle groups (today + future)
    const plannedGroups: string[] = [];
    if (todayDay) plannedGroups.push(...(todayDay.muscle_groups ?? []));
    for (const day of futureDays) {
      plannedGroups.push(...(day.muscle_groups ?? []));
    }

    // 6. Compute deficit
    const deficit = computeMuscleGroupDeficit(missedGroups, plannedGroups);

    const now = new Date();
    const skippedIds = skippedDays.map((d: any) => d.id);

    // 7. No deficit — mark skipped, no redistribution needed. (We used to
    // also bail when futureDays was empty, which left users staring at a
    // "rest day" late in the week even with a deficit. Now we fall through
    // to step 9 which can promote a rest day — including today's.)
    if (deficit.length === 0) {
      await this.prisma.planDay.updateMany({
        where: { id: { in: skippedIds } },
        data: { status: 'skipped', adapted_at: now },
      });
      this.analytics.track(userId, 'plan_adapted', {
        plan_id: plan.id,
        skipped_days: skippedDays.map((d: any) => d.day_of_week),
        adapted_days: [],
      });
      return true;
    }

    // 8. Distribute deficit across future days
    const allowedEquipment =
      EQUIPMENT_MAP[onboarding?.available_equipment ?? ''] ?? [];

    const [exerciseLibrary, recentExerciseIds] = await Promise.all([
      this.prisma.exerciseLibrary.findMany({
        where: {
          OR: [{ is_system: true }, { user_id: userId }],
          ...(allowedEquipment.length > 0
            ? { equipment: { in: allowedEquipment } }
            : {}),
        },
        orderBy: { name: 'asc' },
      }),
      getRecentExerciseIds(this.prisma, userId),
    ]);

    const repScheme = getRepScheme(onboarding?.primary_goals ?? []);
    const userLevel = onboarding?.experience_level ?? null;

    const adaptedDayIds: string[] = [];
    let remainingDeficit = [...deficit];

    await this.prisma.$transaction(async (tx) => {
      // Distribute to existing future training days (max +2 groups per day)
      for (const day of futureDays) {
        if (remainingDeficit.length === 0) break;

        const toAdd = remainingDeficit.splice(0, 2);

        const slots: ExerciseSlot[] = toAdd.map((group) => ({
          muscle_group: group,
          rep_scheme: repScheme,
          focus: null,
        }));

        const picks = matchExercisesToSlots(
          slots,
          exerciseLibrary,
          recentExerciseIds,
          userLevel,
        );

        const newExercises = picks.map((pick, i) => ({
          library_exercise_id: pick.id,
          external_id: pick.external_id,
          name: pick.name,
          muscle_group: pick.muscle_group,
          equipment: pick.equipment,
          sets_display: slots[i].rep_scheme,
        }));

        const existingExercises = day.exercises_json as any[];
        const updatedExercises = [...existingExercises, ...newExercises];

        const existingGroups = day.muscle_groups as string[];
        const addedGroups = [
          ...new Set(newExercises.map((e) => e.muscle_group)),
        ];
        const mergedGroups = [...new Set([...existingGroups, ...addedGroups])];

        const updatedTitle = mergedGroups.join(' & ') + ' Day';

        await tx.planDay.update({
          where: { id: day.id },
          data: {
            exercises_json: updatedExercises,
            muscle_groups: mergedGroups,
            session_title: updatedTitle,
            adapted_at: now,
          },
        });

        adaptedDayIds.push(day.id);
      }

      // 9. If deficit remains — convert earliest available rest day to
      // training. We include today (>=, not >) so a user who shows up on
      // what was scheduled as a rest day actually gets a workout.
      if (remainingDeficit.length > 0) {
        const futureRestDays = plan.days.filter(
          (d: any) =>
            d.day_type === 'rest' &&
            d.day_of_week >= todayDow &&
            d.status === 'pending',
        );

        if (futureRestDays.length > 0) {
          const restDay = futureRestDays[0];
          const slots: ExerciseSlot[] = remainingDeficit.map((group) => ({
            muscle_group: group,
            rep_scheme: repScheme,
            focus: null,
          }));

          const picks = matchExercisesToSlots(
            slots,
            exerciseLibrary,
            recentExerciseIds,
            userLevel,
          );

          const exercises = picks.map((pick, i) => ({
            library_exercise_id: pick.id,
            external_id: pick.external_id,
            name: pick.name,
            muscle_group: pick.muscle_group,
            equipment: pick.equipment,
            sets_display: slots[i].rep_scheme,
          }));

          const muscleGroups = [
            ...new Set(exercises.map((e) => e.muscle_group)),
          ];
          const title = muscleGroups.join(' & ') + ' Day';

          await tx.planDay.update({
            where: { id: restDay.id },
            data: {
              day_type: 'training',
              session_title: title,
              session_type: 'strength',
              muscle_groups: muscleGroups,
              exercises_json: exercises,
              adapted_at: now,
            },
          });

          adaptedDayIds.push(restDay.id);
          remainingDeficit = [];
        }
      }

      // Mark skipped days
      await tx.planDay.updateMany({
        where: { id: { in: skippedIds } },
        data: { status: 'skipped', adapted_at: now },
      });
    });

    this.analytics.track(userId, 'plan_adapted', {
      plan_id: plan.id,
      skipped_days: skippedDays.map((d: any) => d.day_of_week),
      adapted_days: adaptedDayIds,
      deficit_groups: deficit,
    });

    return true;
  }
}

function computeMuscleGroupDeficit(
  missed: string[],
  planned: string[],
): string[] {
  const missedCounts = new Map<string, number>();
  for (const g of missed) {
    const norm = normalizeMuscleGroup(g);
    missedCounts.set(norm, (missedCounts.get(norm) ?? 0) + 1);
  }

  const plannedCounts = new Map<string, number>();
  for (const g of planned) {
    const norm = normalizeMuscleGroup(g);
    plannedCounts.set(norm, (plannedCounts.get(norm) ?? 0) + 1);
  }

  const deficit: string[] = [];
  for (const [group, count] of missedCounts) {
    const diff = count - (plannedCounts.get(group) ?? 0);
    for (let i = 0; i < diff; i++) {
      deficit.push(group);
    }
  }

  return deficit;
}
