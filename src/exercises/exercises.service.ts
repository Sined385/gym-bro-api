import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/exercises.dto';

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

    const exercises = await this.prisma.exerciseLibrary.findMany({
      where,
      orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        muscle_group: true,
        equipment: true,
        is_system: true,
      },
    });

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

  async getPreviousSets(userId: string, exerciseId: string) {
    const sessionExercise = await this.prisma.sessionExercise.findFirst({
      where: {
        library_exercise_id: exerciseId,
        session: {
          user_id: userId,
          status: 'completed',
        },
      },
      orderBy: {
        session: { completed_at: 'desc' },
      },
      include: {
        exercise_sets: { orderBy: { set_number: 'asc' } },
        session: { select: { completed_at: true } },
      },
    });

    if (!sessionExercise) {
      return { exercise_id: exerciseId, session_date: null, sets: [] };
    }

    return {
      exercise_id: exerciseId,
      session_date: sessionExercise.session.completed_at?.toISOString() ?? null,
      sets: sessionExercise.exercise_sets.map((s) => ({
        set_number: s.set_number,
        weight: s.weight ? Number(s.weight) : null,
        weight_unit: s.weight_unit,
        reps: s.reps,
      })),
    };
  }
}
