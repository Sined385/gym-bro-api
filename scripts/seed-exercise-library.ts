import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const MUSCLE_GROUP_MAP: Record<string, string> = {
  chest: 'Chest',
  lats: 'Back',
  'middle back': 'Back',
  'lower back': 'Back',
  traps: 'Back',
  neck: 'Back',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Legs',
  calves: 'Legs',
  adductors: 'Legs',
  abductors: 'Legs',
  shoulders: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  abdominals: 'Core',
};

const EQUIPMENT_MAP: Record<string, string> = {
  barbell: 'Barbell',
  'e-z curl bar': 'Barbell',
  dumbbell: 'Dumbbells',
  kettlebells: 'Dumbbells',
  cable: 'Cable',
  machine: 'Machine',
  'body only': 'Bodyweight',
  'exercise ball': 'Bodyweight',
  'medicine ball': 'Bodyweight',
  bands: 'Bands',
  other: 'Other',
};

interface RawExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  category: string;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const dataPath = path.join(__dirname, '..', 'data', 'exercises.json');
    const raw: RawExercise[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Cardio entries are normally filtered out — the iOS app and Coach
    // pipeline treat exercises as strength by default. These 9 are the
    // ones we ship; everything else under category=cardio stays gated.
    // Keep in sync with AVAILABLE_CARDIO_EXTERNAL_IDS in
    // src/common/exercise-set-synth.ts (read-time filter).
    const ALLOWED_CARDIO = new Set([
      'Bicycling_Stationary',
      'Elliptical_Trainer',
      'Jogging_Treadmill',
      'Recumbent_Bike',
      'Rope_Jumping',
      'Rowing_Stationary',
      'Running_Treadmill',
      'Stairmaster',
      'Walking_Treadmill',
    ]);

    const filtered = raw.filter((e) => {
      if (e.category === 'stretching') return false;
      if (e.category === 'cardio' && !ALLOWED_CARDIO.has(e.id)) return false;
      if (e.equipment === 'foam roll') return false;
      return true;
    });

    // Map to internal schema. Cardio exercises get their own muscle_group
    // bucket so users can filter the library to them; without this they'd
    // bucket as "Legs" (yuhonas tags treadmill/bike primaryMuscles as
    // quadriceps), losing the cardio identity.
    const mapped = filtered.map((e) => {
      const isCardio = e.category === 'cardio';
      const primaryMuscle = e.primaryMuscles?.[0] ?? '';
      const muscleGroup = isCardio
        ? 'Cardio'
        : (MUSCLE_GROUP_MAP[primaryMuscle] ?? 'Other');
      const equipment =
        e.equipment === null
          ? 'Bodyweight'
          : (EQUIPMENT_MAP[e.equipment] ?? 'Other');

      return {
        name: e.name,
        muscle_group: muscleGroup,
        equipment,
        is_system: true,
        external_id: e.id,
        level: e.level ?? null,
        category: e.category ?? null,
        force: e.force ?? null,
        mechanic: e.mechanic ?? null,
      };
    });

    console.log(
      `Filtered: ${filtered.length} exercises (from ${raw.length} total)`,
    );

    // Idempotent UPSERT keyed by external_id. Existing rows keep their
    // UUID (so session_exercise.library_exercise_id FKs stay valid),
    // only the mutable metadata fields update. New upstream exercises
    // get a fresh UUID on first insert and that UUID is then stable
    // forever. Exercises removed from upstream are left in the DB
    // because session_exercise rows likely reference them — deleting
    // would orphan user history. Soft-deactivation via an `inactive`
    // flag is the right move when that becomes a real concern.
    let created = 0;
    let updated = 0;
    for (const ex of mapped) {
      const result = await prisma.exerciseLibrary.upsert({
        where: { external_id: ex.external_id },
        update: {
          name: ex.name,
          muscle_group: ex.muscle_group,
          equipment: ex.equipment,
          is_system: true,
          level: ex.level,
          category: ex.category,
          force: ex.force,
          mechanic: ex.mechanic,
          // Deliberately NOT touching `id`, `user_id`, `created_at`.
        },
        create: ex,
        select: { id: true, created_at: true },
      });
      // created_at within the last 5s is a heuristic for "just inserted";
      // good enough for the summary line.
      if (Date.now() - result.created_at.getTime() < 5_000) created++;
      else updated++;
    }
    console.log(
      `Upserted ${mapped.length} system exercises (${created} created, ${updated} updated)`,
    );

    // Print summary
    const byMuscle: Record<string, number> = {};
    const byEquipment: Record<string, number> = {};
    for (const e of mapped) {
      byMuscle[e.muscle_group] = (byMuscle[e.muscle_group] ?? 0) + 1;
      byEquipment[e.equipment] = (byEquipment[e.equipment] ?? 0) + 1;
    }

    console.log('\nBy muscle group:');
    for (const [k, v] of Object.entries(byMuscle).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }

    console.log('\nBy equipment:');
    for (const [k, v] of Object.entries(byEquipment).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${k}: ${v}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
