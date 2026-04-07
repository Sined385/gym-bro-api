import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/exercises.dto';

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

    const rows = await this.prisma.exerciseLibrary.findMany({
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
    });

    const exercises = rows.map((r) => ({
      id: r.id,
      name: r.name,
      muscle_group: r.muscle_group,
      equipment: r.equipment,
      is_system: r.is_system,
      external_id: r.external_id ?? null,
      images: r.external_id
        ? [
            `${IMAGE_BASE_URL}/${r.external_id}/0.jpg`,
            `${IMAGE_BASE_URL}/${r.external_id}/1.jpg`,
          ]
        : [],
    }));

    return { exercises };
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
    return {
      ...exercise,
      external_id: exercise.external_id ?? null,
      images: exercise.external_id
        ? [
            `${IMAGE_BASE_URL}/${exercise.external_id}/0.jpg`,
            `${IMAGE_BASE_URL}/${exercise.external_id}/1.jpg`,
          ]
        : [],
    };
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
        })),
      })),
    };
  }
}
