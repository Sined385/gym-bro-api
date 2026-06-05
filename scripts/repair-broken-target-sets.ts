/**
 * One-time: repair plan_day.exercises_json[i].target_sets entries
 * that were persisted in the wrong shape by the buggy first version
 * of synthesizeTargetSets (returned `{ weight_kg, reps, is_bodyweight }`
 * instead of the canonical `{ set_number, weight, weight_unit, reps,
 * is_bodyweight }`).
 *
 * The broken shape is silently dropped by iOS's Codable decode because
 * setNumber: Int is non-optional, so the entire `sets` array fails to
 * decode and the preview sheet falls back to the bare pill.
 *
 * Idempotent: only rewrites entries missing `set_number`. Already-
 * correct entries are passed through unchanged.
 *
 * Run: railway run npx ts-node scripts/repair-broken-target-sets.ts
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface BrokenSet {
  reps: number;
  is_bodyweight?: boolean;
  weight_kg?: number;
}

interface CanonicalSet {
  set_number: number;
  weight: number | null;
  weight_unit: string;
  reps: number;
  is_bodyweight: boolean;
}

function isBroken(s: any): s is BrokenSet {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.reps === 'number' &&
    typeof s.set_number !== 'number'
  );
}

function repair(sets: any[]): CanonicalSet[] {
  return sets.map((s, i) => ({
    set_number: i + 1,
    // The old shape carried weight under `weight_kg`. Translate it back.
    weight:
      s.weight_kg !== undefined && s.weight_kg !== null
        ? Number(s.weight_kg)
        : s.weight !== undefined && s.weight !== null
          ? Number(s.weight)
          : null,
    weight_unit: typeof s.weight_unit === 'string' ? s.weight_unit : 'kg',
    reps: s.reps,
    is_bodyweight: s.is_bodyweight === true,
  }));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const days = await prisma.planDay.findMany({
      where: { day_type: 'training' },
      select: { id: true, exercises_json: true, alt_session_json: true },
    });
    console.log(`Scanning ${days.length} training plan_days.`);

    let updated = 0;
    for (const day of days) {
      let changed = false;

      const exercises = (day.exercises_json as any[]) ?? [];
      const fixedExercises = exercises.map((ex: any) => {
        if (!Array.isArray(ex?.target_sets) || ex.target_sets.length === 0) {
          return ex;
        }
        if (!ex.target_sets.some(isBroken)) return ex;
        changed = true;
        return { ...ex, target_sets: repair(ex.target_sets) };
      });

      let fixedAlt = day.alt_session_json as any;
      if (
        fixedAlt &&
        Array.isArray(fixedAlt.exercises) &&
        fixedAlt.exercises.length > 0
      ) {
        const altExs = fixedAlt.exercises.map((ex: any) => {
          if (!Array.isArray(ex?.target_sets) || ex.target_sets.length === 0) {
            return ex;
          }
          if (!ex.target_sets.some(isBroken)) return ex;
          changed = true;
          return { ...ex, target_sets: repair(ex.target_sets) };
        });
        fixedAlt = { ...fixedAlt, exercises: altExs };
      }

      if (!changed) continue;
      await prisma.planDay.update({
        where: { id: day.id },
        data: {
          exercises_json: fixedExercises as any,
          ...(fixedAlt !== day.alt_session_json
            ? { alt_session_json: fixedAlt as any }
            : {}),
        },
      });
      updated++;
    }
    console.log(`Repaired ${updated} plan_days.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('repair-broken-target-sets failed:', err);
  process.exit(1);
});
