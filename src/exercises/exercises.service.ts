import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/exercises.dto';
import { AppException } from '../common/exceptions/app.exception';
import { serializeExerciseSets } from '../common/format-session';
import { isHiddenCardio } from '../common/exercise-set-synth';

const IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async listExercises(userId: string, search?: string, muscleGroup?: string) {
    const where: any = {
      OR: [{ is_system: true }, { user_id: userId }],
    };

    if (search) {
      // Search matches either the English or the Ukrainian name, so uk
      // users can type «жим» and still find "Bench Press". AND keeps
      // the visibility OR (system + own exercises) intact.
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { name_uk: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (muscleGroup) {
      where.muscle_group = muscleGroup;
    }

    const [rows, favIds, lastSetMap] = await Promise.all([
      this.prisma.exerciseLibrary.findMany({
        where,
        orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          muscle_group: true,
          equipment: true,
          is_system: true,
          external_id: true,
        },
      }),
      this.fetchFavoriteIdSet(userId),
      this.fetchLastSetMap(userId),
    ]);

    // Hide non-walking cardio for now (rows stay in the DB).
    const mapped = rows
      .filter((r) => !isHiddenCardio(r))
      .map((r) => ({
        id: r.id,
        name: r.name,
        muscle_group: r.muscle_group,
        equipment: r.equipment,
        is_system: r.is_system,
        external_id: r.external_id ?? null,
        is_favorite: favIds.has(r.id),
        images: r.external_id
          ? [
              `${IMAGE_BASE_URL}/${r.external_id}/0.jpg`,
              `${IMAGE_BASE_URL}/${r.external_id}/1.jpg`,
            ]
          : [],
        last_set: lastSetMap.get(r.id) ?? null,
      }));

    // Stable partition: favorites first, others preserve DB order. Prisma can't
    // orderBy a computed column, so we do this final pass in JS.
    const favorites = mapped.filter((e) => e.is_favorite);
    const rest = mapped.filter((e) => !e.is_favorite);
    return { exercises: [...favorites, ...rest] };
  }

  /**
   * Exercise-name translation map for the given language, keyed by
   * external_id so iOS can overlay localized names on any payload that
   * carries external_id (library, sessions, plans) without the server
   * localizing every response. Only 'uk' has data today; other langs
   * return an empty map so the contract stays stable.
   */
  async getTranslations(lang: string) {
    if (lang !== 'uk') return { translations: {} };

    const rows = await this.prisma.exerciseLibrary.findMany({
      where: {
        is_system: true,
        name_uk: { not: null },
        external_id: { not: null },
      },
      select: { external_id: true, name_uk: true },
    });

    const translations: Record<string, string> = {};
    for (const r of rows) {
      translations[r.external_id!] = r.name_uk!;
    }
    return { translations };
  }

  /**
   * For each library exercise the user has performed at least once, returns
   * the user's most recent completed set on that exercise (highest set_number
   * from the most recent completed session). Used as a hint on the library
   * card so the user can recall where they left off before picking an
   * exercise to add.
   */
  private async fetchLastSetMap(userId: string): Promise<
    Map<
      string,
      {
        weight: number | null;
        weight_unit: string;
        reps: number;
        is_bodyweight: boolean;
        duration_seconds: number | null;
        distance_meters: number | null;
        completed_at: string | null;
      }
    >
  > {
    const rows = await this.prisma.sessionExercise.findMany({
      where: {
        library_exercise_id: { not: null },
        session: { user_id: userId, status: 'completed' },
        exercise_sets: { some: {} },
      },
      select: {
        library_exercise_id: true,
        session: { select: { completed_at: true } },
        exercise_sets: {
          orderBy: { set_number: 'desc' },
          take: 1,
          select: {
            weight: true,
            weight_unit: true,
            reps: true,
            is_bodyweight: true,
            duration_seconds: true,
            distance_meters: true,
          },
        },
      },
      orderBy: { session: { completed_at: 'desc' } },
    });

    const map = new Map<
      string,
      {
        weight: number | null;
        weight_unit: string;
        reps: number;
        is_bodyweight: boolean;
        duration_seconds: number | null;
        distance_meters: number | null;
        completed_at: string | null;
      }
    >();
    for (const r of rows) {
      if (!r.library_exercise_id || map.has(r.library_exercise_id)) continue;
      const set = r.exercise_sets[0];
      if (!set) continue;
      map.set(r.library_exercise_id, {
        weight: set.weight !== null ? Number(set.weight) : null,
        weight_unit: set.weight_unit,
        reps: set.reps,
        is_bodyweight: set.is_bodyweight,
        duration_seconds: set.duration_seconds ?? null,
        distance_meters: set.distance_meters ?? null,
        completed_at: r.session.completed_at?.toISOString() ?? null,
      });
    }
    return map;
  }

  async createExercise(userId: string, dto: CreateExerciseDto) {
    const exercise = await this.prisma.exerciseLibrary.create({
      data: {
        user_id: userId,
        name: dto.name,
        muscle_group: dto.muscle_group,
        equipment: dto.equipment,
        is_system: false,
        // category drives all cardio behavior downstream (duration-based
        // sets in coach/plans, no weight suggestions). Without it a
        // user-created "Cardio" exercise renders as a sets/reps lift.
        category: dto.muscle_group === 'Cardio' ? 'cardio' : null,
      },
      select: {
        id: true,
        name: true,
        muscle_group: true,
        equipment: true,
        is_system: true,
        category: true,
      },
    });

    return exercise;
  }

  async getExercise(userId: string, exerciseId: string) {
    const exercise = await this.prisma.exerciseLibrary.findFirst({
      where: { id: exerciseId, OR: [{ is_system: true }, { user_id: userId }] },
      select: {
        id: true,
        name: true,
        muscle_group: true,
        equipment: true,
        is_system: true,
        external_id: true,
      },
    });
    if (!exercise) return null;
    const isFavorite = await this.isFavorited(userId, exerciseId);
    return {
      ...exercise,
      external_id: exercise.external_id ?? null,
      is_favorite: isFavorite,
      images: exercise.external_id
        ? [
            `${IMAGE_BASE_URL}/${exercise.external_id}/0.jpg`,
            `${IMAGE_BASE_URL}/${exercise.external_id}/1.jpg`,
          ]
        : [],
    };
  }

  async favoriteExercise(userId: string, exerciseId: string) {
    await this.assertAccessible(userId, exerciseId);
    await this.prisma.exerciseFavorite.upsert({
      where: {
        user_id_exercise_id: { user_id: userId, exercise_id: exerciseId },
      },
      update: {},
      create: { user_id: userId, exercise_id: exerciseId },
    });
    return { exercise_id: exerciseId, is_favorite: true };
  }

  async unfavoriteExercise(userId: string, exerciseId: string) {
    // No accessibility check on unfavorite — if the row exists, the user owns it
    // (uniqueness is keyed on user_id). deleteMany is idempotent.
    await this.prisma.exerciseFavorite.deleteMany({
      where: { user_id: userId, exercise_id: exerciseId },
    });
    return { exercise_id: exerciseId, is_favorite: false };
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async fetchFavoriteIdSet(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.exerciseFavorite.findMany({
      where: { user_id: userId },
      select: { exercise_id: true },
    });
    return new Set(rows.map((r) => r.exercise_id));
  }

  private async isFavorited(
    userId: string,
    exerciseId: string,
  ): Promise<boolean> {
    const row = await this.prisma.exerciseFavorite.findUnique({
      where: {
        user_id_exercise_id: { user_id: userId, exercise_id: exerciseId },
      },
      select: { id: true },
    });
    return row !== null;
  }

  private async assertAccessible(
    userId: string,
    exerciseId: string,
  ): Promise<void> {
    const row = await this.prisma.exerciseLibrary.findFirst({
      where: { id: exerciseId, OR: [{ is_system: true }, { user_id: userId }] },
      select: { id: true },
    });
    if (!row) {
      throw new AppException(
        'EXERCISE_NOT_FOUND',
        'Exercise not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async getPreviousSets(userId: string, exerciseId: string) {
    // First try matching by library_exercise_id
    let sessionExercises = await this.prisma.sessionExercise.findMany({
      where: {
        library_exercise_id: exerciseId,
        session: {
          user_id: userId,
          status: 'completed',
        },
        exercise_sets: { some: {} },
      },
      orderBy: {
        session: { completed_at: 'desc' },
      },
      include: {
        exercise_sets: { orderBy: { set_number: 'asc' } },
        session: { select: { completed_at: true } },
      },
      take: 10,
    });

    // Fallback: match by exercise name (covers AI-created exercises without library_exercise_id)
    if (sessionExercises.length === 0) {
      const libraryExercise = await this.prisma.exerciseLibrary.findUnique({
        where: { id: exerciseId },
        select: { name: true },
      });

      if (libraryExercise) {
        sessionExercises = await this.prisma.sessionExercise.findMany({
          where: {
            name: { equals: libraryExercise.name, mode: 'insensitive' },
            session: {
              user_id: userId,
              status: 'completed',
            },
            exercise_sets: { some: {} },
          },
          orderBy: {
            session: { completed_at: 'desc' },
          },
          include: {
            exercise_sets: { orderBy: { set_number: 'asc' } },
            session: { select: { completed_at: true } },
          },
          take: 10,
        });
      }
    }

    return {
      exercise_id: exerciseId,
      sessions: sessionExercises.map((se) => ({
        session_date: se.session.completed_at?.toISOString() ?? null,
        // Route through the canonical serializer so cardio's
        // duration_seconds + distance_meters reach iOS. Strength sets
        // get the same {set_number, weight, weight_unit, reps,
        // is_bodyweight} shape as before plus null cardio fields.
        sets: serializeExerciseSets(se.exercise_sets as any),
      })),
    };
  }
}
