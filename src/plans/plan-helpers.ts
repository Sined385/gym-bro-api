import { PrismaService } from '../prisma/prisma.service';

// Plain functions (not a service) — both PlanGeneratorService and
// PlanAdapterService share these but neither needs to inject the other.
// Keeping them stateless avoids adding another Nest provider for what
// amounts to two narrow queries and one switch.

const RECENT_LOOKBACK_DAYS = 14;

function twoWeeksAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - RECENT_LOOKBACK_DAYS);
  return d;
}

export async function getRecentExerciseIds(
  prisma: PrismaService,
  userId: string,
): Promise<Set<string>> {
  const rows = await prisma.sessionExercise.findMany({
    where: {
      library_exercise_id: { not: null },
      session: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: twoWeeksAgo() },
      },
    },
    select: { library_exercise_id: true },
  });

  return new Set(
    rows
      .map((e) => e.library_exercise_id)
      .filter((id): id is string => id !== null),
  );
}

export async function getRecentExerciseNames(
  prisma: PrismaService,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.sessionExercise.findMany({
    where: {
      session: {
        user_id: userId,
        status: 'completed',
        completed_at: { gte: twoWeeksAgo() },
      },
    },
    select: { name: true },
    distinct: ['name'],
    take: 20,
  });
  return rows.map((e) => e.name);
}

export function getRepScheme(goals: string[]): string {
  if (goals.includes('get_stronger')) return '4 × 6';
  if (goals.includes('lose_fat')) return '3 × 12';
  return '3 × 10';
}
