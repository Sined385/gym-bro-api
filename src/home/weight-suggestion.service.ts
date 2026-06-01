import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Body-weight ratio table: muscle_group → equipment → experience_level → ratio
// Multiply by body_weight_kg to get suggested weight in kg
const WEIGHT_RATIOS: Record<string, Record<string, Record<string, number>>> = {
  Chest: {
    Barbell: { beginner: 0.5, intermediate: 0.75, advanced: 1.0 },
    Dumbbells: { beginner: 0.15, intermediate: 0.25, advanced: 0.35 },
    Machine: { beginner: 0.4, intermediate: 0.6, advanced: 0.8 },
    Cable: { beginner: 0.4, intermediate: 0.6, advanced: 0.8 },
  },
  Back: {
    Barbell: { beginner: 0.4, intermediate: 0.65, advanced: 0.85 },
    Dumbbells: { beginner: 0.12, intermediate: 0.2, advanced: 0.3 },
    Machine: { beginner: 0.35, intermediate: 0.55, advanced: 0.75 },
    Cable: { beginner: 0.35, intermediate: 0.55, advanced: 0.75 },
  },
  Legs: {
    Barbell: { beginner: 0.6, intermediate: 1.0, advanced: 1.5 },
    Dumbbells: { beginner: 0.15, intermediate: 0.25, advanced: 0.35 },
    Machine: { beginner: 0.5, intermediate: 0.8, advanced: 1.2 },
    Cable: { beginner: 0.5, intermediate: 0.8, advanced: 1.2 },
  },
  Shoulders: {
    Barbell: { beginner: 0.3, intermediate: 0.45, advanced: 0.6 },
    Dumbbells: { beginner: 0.1, intermediate: 0.15, advanced: 0.2 },
    Machine: { beginner: 0.25, intermediate: 0.35, advanced: 0.5 },
    Cable: { beginner: 0.25, intermediate: 0.35, advanced: 0.5 },
  },
  Arms: {
    Barbell: { beginner: 0.2, intermediate: 0.3, advanced: 0.4 },
    Dumbbells: { beginner: 0.08, intermediate: 0.12, advanced: 0.18 },
    Machine: { beginner: 0.15, intermediate: 0.25, advanced: 0.35 },
    Cable: { beginner: 0.15, intermediate: 0.25, advanced: 0.35 },
  },
};

// Equipment types that don't need weight suggestions
const NO_WEIGHT_EQUIPMENT = ['Bodyweight', 'Bands'];

@Injectable()
export class WeightSuggestionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Suggests weights for a list of exercises based on user history or body-weight estimates.
   * Returns a Map keyed by library_exercise_id → suggested weight (kg) or null.
   */
  async suggestWeights(
    userId: string,
    exercises: {
      library_exercise_id: string | null;
      muscle_group: string;
      equipment: string;
    }[],
    onboarding: {
      body_weight_kg?: number | null;
      experience_level: string;
      primary_goals: string[];
    },
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();

    // Collect library_exercise_ids that need lookup
    const libraryIds = exercises
      .map((e) => e.library_exercise_id)
      .filter((id): id is string => id !== null);

    // Query latest logged weight per library_exercise_id from user's completed sessions
    const historyMap = new Map<string, number>();
    if (libraryIds.length > 0) {
      try {
        const recentExercises = await this.prisma.sessionExercise.findMany({
          where: {
            library_exercise_id: { in: libraryIds },
            session: {
              user_id: userId,
              status: 'completed',
            },
            exercise_sets: {
              some: { weight: { not: null } },
            },
          },
          select: {
            library_exercise_id: true,
            session: { select: { completed_at: true } },
            exercise_sets: {
              where: { weight: { not: null } },
              orderBy: { set_number: 'desc' },
              take: 1,
              select: { weight: true },
            },
          },
          orderBy: { session: { completed_at: 'desc' } },
        });

        // Group by library_exercise_id, keep the most recent
        for (const ex of recentExercises) {
          const libId = ex.library_exercise_id;
          if (!libId || historyMap.has(libId)) continue;
          const weight = ex.exercise_sets[0]?.weight;
          if (weight !== null && weight !== undefined) {
            historyMap.set(libId, Number(weight));
          }
        }
      } catch {
        // If query fails, fall through to estimates
      }
    }

    const bodyWeight = onboarding.body_weight_kg ?? 70;
    const experience = onboarding.experience_level ?? 'intermediate';
    const isGetStronger = onboarding.primary_goals?.[0] === 'get_stronger';

    for (const ex of exercises) {
      const key = ex.library_exercise_id;
      if (!key) {
        result.set('', null);
        continue;
      }

      // Bodyweight/bands exercises → no weight
      if (NO_WEIGHT_EQUIPMENT.includes(ex.equipment)) {
        result.set(key, null);
        continue;
      }

      // Priority 1: user history
      const lastWeight = historyMap.get(key);
      if (lastWeight !== undefined) {
        let weight = lastWeight;
        if (isGetStronger) weight += 2.5;
        weight = this.roundWeight(weight, ex.equipment);
        result.set(key, weight);
        continue;
      }

      // Priority 2: body-weight estimate
      const muscleRatios = WEIGHT_RATIOS[ex.muscle_group];
      if (!muscleRatios) {
        result.set(key, null);
        continue;
      }

      const equipRatios = muscleRatios[ex.equipment];
      if (!equipRatios) {
        result.set(key, null);
        continue;
      }

      const ratio = equipRatios[experience] ?? equipRatios['intermediate'] ?? 0;
      if (ratio === 0) {
        result.set(key, null);
        continue;
      }

      let estimated = bodyWeight * ratio;
      estimated = this.roundWeight(estimated, ex.equipment);
      result.set(key, estimated);
    }

    return result;
  }

  private roundWeight(weight: number, equipment: string): number {
    if (equipment === 'Dumbbells') {
      return Math.round(weight / 2) * 2;
    }
    // Barbell, Machine, Cable → round to nearest 2.5
    return Math.round(weight / 2.5) * 2.5;
  }
}
