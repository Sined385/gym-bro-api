import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/exercises.dto';
import { AppException } from '../common/exceptions/app.exception';

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
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (muscleGroup) {
      where.muscle_group = muscleGroup;
    }

    const [rows, favIds] = await Promise.all([
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
    ]);

    const mapped = rows.map((r) => ({
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
    }));

    // Stable partition: favorites first, others preserve DB order. Prisma can't
    // orderBy a computed column, so we do this final pass in JS.
    const favorites = mapped.filter((e) => e.is_favorite);
    const rest = mapped.filter((e) => !e.is_favorite);
    return { exercises: [...favorites, ...rest] };
  }

  async createExercise(userId: string, dto: CreateExerciseDto) {
    const exercise = await this.prisma.exerciseLibrary.create({
      data: {
        user_id: userId,
        name: dto.name,
        muscle_group: dto.muscle_group,
        equipment: dto.equipment,
        is_system: false,
      },
      select: {
        id: true,
        name: true,
        muscle_group: true,
        equipment: true,
        is_system: true,
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
      where: { user_id_exercise_id: { user_id: userId, exercise_id: exerciseId } },
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
      where: { user_id_exercise_id: { user_id: userId, exercise_id: exerciseId } },
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
        sets: se.exercise_sets.map((s) => ({
          set_number: s.set_number,
          weight: s.weight ? Number(s.weight) : null,
          weight_unit: s.weight_unit,
          reps: s.reps,
          is_bodyweight: s.is_bodyweight,
        })),
      })),
    };
  }
}
