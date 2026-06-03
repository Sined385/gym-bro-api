// Seeds the ExerciseLibrary table from data/exercises.json.
// Source of truth: git@github.com:Sined385/gym-bro-exercises.git
// Run `npm run refresh:exercises` to pull the latest dataset before seeding.

const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MUSCLE_GROUP_MAP = {
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

const EQUIPMENT_MAP = {
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

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const dataPath = path.join(__dirname, '..', 'data', 'exercises.json');
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Filter out stretching, cardio, and foam roll
    const filtered = raw.filter(
      (e) =>
        !['stretching', 'cardio'].includes(e.category) &&
        e.equipment !== 'foam roll',
    );

    // Map to internal schema
    const mapped = filtered.map((e) => {
      const primaryMuscle = (e.primaryMuscles && e.primaryMuscles[0]) || '';
      const muscleGroup = MUSCLE_GROUP_MAP[primaryMuscle] || 'Other';
      const equipment =
        e.equipment === null
          ? 'Bodyweight'
          : (EQUIPMENT_MAP[e.equipment] || 'Other');

      return {
        name: e.name,
        muscle_group: muscleGroup,
        equipment,
        is_system: true,
        external_id: e.id,
        level: e.level || null,
        category: e.category || null,
        force: e.force || null,
        mechanic: e.mechanic || null,
      };
    });

    console.log(`Filtered: ${filtered.length} exercises (from ${raw.length} total)`);

    // Run in transaction
    await prisma.$transaction(async (tx) => {
      // Detach session_exercises from old system exercises
      const detached = await tx.sessionExercise.updateMany({
        where: {
          library_exercise: { is_system: true },
        },
        data: { library_exercise_id: null },
      });
      console.log(`Detached ${detached.count} session exercises`);

      // Delete old system exercises
      const deleted = await tx.exerciseLibrary.deleteMany({
        where: { is_system: true },
      });
      console.log(`Deleted ${deleted.count} old system exercises`);

      // Bulk insert new exercises
      const created = await tx.exerciseLibrary.createMany({
        data: mapped,
      });
      console.log(`Inserted ${created.count} new exercises`);
    });

    // Print summary
    const byMuscle = {};
    const byEquipment = {};
    for (const e of mapped) {
      byMuscle[e.muscle_group] = (byMuscle[e.muscle_group] || 0) + 1;
      byEquipment[e.equipment] = (byEquipment[e.equipment] || 0) + 1;
    }

    console.log('\nBy muscle group:');
    for (const [k, v] of Object.entries(byMuscle).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }

    console.log('\nBy equipment:');
    for (const [k, v] of Object.entries(byEquipment).sort((a, b) => b[1] - a[1])) {
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
