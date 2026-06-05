/**
 * One-time: for every plan_day with a linked workout_session_id,
 * merge the linked session's per-set targets (exercise_sets rows)
 * into exercises_json so the Plan tab / dashboard planned_workout
 * surfaces real weights after the read-path fix.
 *
 * Background: linkSessionToToday and adaptPlanDayToActualSession used
 * to write exercises_json without including per-set targets. The fix
 * in this PR includes them going forward, but existing plan_day rows
 * still have the bare shape — this script catches them up.
 *
 * Idempotent: re-running is safe. It only writes when (a) the linked
 * session has exercise_sets and (b) the existing exercises_json entry
 * doesn't already have target_sets.
 *
 * Run:  npx ts-node scripts/backfill-plan-day-target-sets.ts
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface ExerciseSetJson {
  set_number: number;
  weight: number | null;
  weight_unit: string;
  reps: number;
  is_bodyweight: boolean;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const days = await prisma.planDay.findMany({
      where: {
        workout_session_id: { not: null },
        day_type: 'training',
      },
      select: {
        id: true,
        workout_session_id: true,
        exercises_json: true,
      },
    });
    console.log(`Found ${days.length} candidate plan_days.`);

    let updated = 0;
    let skipped = 0;
    for (const day of days) {
      if (!day.workout_session_id) continue;
      const session = await prisma.workoutSession.findUnique({
        where: { id: day.workout_session_id },
        include: {
          exercises: {
            orderBy: { step_number: 'asc' },
            include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
          },
        },
      });
      if (!session) {
        skipped++;
        continue;
      }

      // Build lookup by library_exercise_id (preferred) and name
      // (fallback for old rows where the FK was nulled by a prior
      // destructive seed before that bug was fixed).
      const byLibId = new Map<string, ExerciseSetJson[]>();
      const byName = new Map<string, ExerciseSetJson[]>();
      for (const se of session.exercises) {
        const sets: ExerciseSetJson[] = se.exercise_sets.map((s: any) => ({
          set_number: s.set_number,
          weight:
            s.weight === null || s.weight === undefined
              ? null
              : typeof s.weight === 'string'
                ? Number(s.weight)
                : s.weight,
          weight_unit: s.weight_unit ?? 'kg',
          reps: s.reps,
          is_bodyweight: s.is_bodyweight ?? false,
        }));
        if (sets.length === 0) continue;
        if (se.library_exercise_id) byLibId.set(se.library_exercise_id, sets);
        if (se.name) byName.set(se.name.toLowerCase().trim(), sets);
      }

      const exercises = (day.exercises_json ?? []) as any[];
      if (!Array.isArray(exercises) || exercises.length === 0) {
        skipped++;
        continue;
      }
      let changed = false;
      const newExercises = exercises.map((ex) => {
        if (Array.isArray(ex.target_sets) && ex.target_sets.length > 0) {
          return ex; // already has sets — leave alone (idempotency)
        }
        const fromLib = ex.library_exercise_id
          ? byLibId.get(ex.library_exercise_id)
          : null;
        const fromName = !fromLib && ex.name
          ? byName.get(ex.name.toLowerCase().trim())
          : null;
        const sets = fromLib ?? fromName;
        if (!sets) return ex;
        changed = true;
        return { ...ex, target_sets: sets };
      });

      if (changed) {
        await prisma.planDay.update({
          where: { id: day.id },
          data: { exercises_json: newExercises as any },
        });
        updated++;
      } else {
        skipped++;
      }
    }
    console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill-plan-day-target-sets failed:', err);
  process.exit(1);
});
