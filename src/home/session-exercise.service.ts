import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  AddExercisesDto,
  CreateSupersetDto,
  LogSetDto,
  UpdateSetDto,
} from './dto/home.dto';
import { exerciseImageUrl } from '../common/exercise-image';

export const ACCENT_COLORS = ['#E86A75', '#30C08D', '#7A82F6', '#F5A623'];

@Injectable()
export class SessionExerciseService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Verification Helpers ──────────────────────────────────

  private async verifySession(userId: string, sessionId: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (session.status === 'completed') {
      throw new AppException(
        'invalid_session_status',
        `Cannot modify a completed session`,
        HttpStatus.CONFLICT,
      );
    }

    return session;
  }

  private async verifyActiveSession(userId: string, sessionId: string) {
    const session = await this.verifySession(userId, sessionId);

    if (session.status !== 'active') {
      throw new AppException(
        'invalid_session_status',
        `Session is not active (status: '${session.status}')`,
        HttpStatus.CONFLICT,
      );
    }

    return session;
  }

  private async verifyExerciseOwnership(sessionId: string, exerciseId: string) {
    const exercise = await this.prisma.sessionExercise.findFirst({
      where: { id: exerciseId, session_id: sessionId },
    });

    if (!exercise) {
      throw new AppException(
        'exercise_not_found',
        'Exercise not found in this session',
        HttpStatus.NOT_FOUND,
      );
    }

    return exercise;
  }

  private async verifySetOwnership(exerciseId: string, setId: string) {
    const set = await this.prisma.exerciseSet.findFirst({
      where: { id: setId, exercise_id: exerciseId },
    });

    if (!set) {
      throw new AppException(
        'set_not_found',
        'Set not found for this exercise',
        HttpStatus.NOT_FOUND,
      );
    }

    return set;
  }

  // ── Exercise CRUD ─────────────────────────────────────────

  async addExercises(userId: string, sessionId: string, dto: AddExercisesDto) {
    await this.verifySession(userId, sessionId);

    const maxStep = await this.prisma.sessionExercise.aggregate({
      where: { session_id: sessionId },
      _max: { step_number: true },
    });

    let currentStep = maxStep._max.step_number ?? 0;

    // Validate library_exercise_ids upfront — stale IDs (e.g. after exercise re-seed) become null
    const candidateIds = dto.exercises
      .map((e) => e.library_exercise_id)
      .filter((id): id is string => !!id);
    const validLibExercises =
      candidateIds.length > 0
        ? new Map(
            (
              await this.prisma.exerciseLibrary.findMany({
                where: { id: { in: candidateIds } },
                select: { id: true, external_id: true },
              })
            ).map((e) => [e.id, e]),
          )
        : new Map<string, { id: string; external_id: string | null }>();

    const created: any[] = [];
    for (const item of dto.exercises) {
      currentStep++;
      const libEx = item.library_exercise_id
        ? validLibExercises.get(item.library_exercise_id)
        : undefined;
      const libId = libEx ? item.library_exercise_id! : null;
      const exercise = await this.prisma.sessionExercise.create({
        data: {
          session_id: sessionId,
          library_exercise_id: libId,
          external_id: libEx?.external_id ?? null,
          name: item.name,
          muscle_group: item.muscle_group,
          equipment: item.equipment ?? null,
          step_number: currentStep,
          accent_color: ACCENT_COLORS[(currentStep - 1) % ACCENT_COLORS.length],
          sets_display: '',
        },
        include: {
          exercise_sets: true,
        },
      });
      created.push({
        id: exercise.id,
        library_exercise_id: exercise.library_exercise_id,
        external_id: exercise.external_id ?? null,
        name: exercise.name,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        step_number: exercise.step_number,
        accent_color: exercise.accent_color,
        image_url: exerciseImageUrl(exercise.external_id),
        sets: [],
      });
    }

    return { exercises: created };
  }

  async createSuperset(
    userId: string,
    sessionId: string,
    dto: CreateSupersetDto,
  ) {
    await this.verifySession(userId, sessionId);

    // Verify all exercise_ids belong to this session
    const exercises = await this.prisma.sessionExercise.findMany({
      where: { id: { in: dto.exercise_ids }, session_id: sessionId },
    });

    if (exercises.length !== dto.exercise_ids.length) {
      throw new AppException(
        'exercise_not_found',
        'One or more exercises not found in this session',
        HttpStatus.NOT_FOUND,
      );
    }

    const supersetGroupId = randomUUID();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const results: {
      id: string;
      name: string;
      superset_group_id: string | null;
      superset_order: string | null;
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dto.exercise_ids.length; i++) {
        const ex = await tx.sessionExercise.update({
          where: { id: dto.exercise_ids[i] },
          data: {
            superset_group_id: supersetGroupId,
            superset_order: letters[i],
          },
        });
        results.push({
          id: ex.id,
          name: ex.name,
          superset_group_id: ex.superset_group_id,
          superset_order: ex.superset_order,
        });
      }
    });

    return { superset_group_id: supersetGroupId, exercises: results };
  }

  async removeExercise(userId: string, sessionId: string, exerciseId: string) {
    await this.verifySession(userId, sessionId);
    const exercise = await this.verifyExerciseOwnership(sessionId, exerciseId);

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionExercise.delete({ where: { id: exerciseId } });

      // If the deleted exercise was in a superset, check remaining members
      if (exercise.superset_group_id) {
        const remaining = await tx.sessionExercise.findMany({
          where: { superset_group_id: exercise.superset_group_id },
        });

        if (remaining.length === 1) {
          await tx.sessionExercise.update({
            where: { id: remaining[0].id },
            data: { superset_group_id: null, superset_order: null },
          });
        }
      }
    });

    return { deleted: true };
  }

  // ── Set CRUD ──────────────────────────────────────────────

  async logSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    dto: LogSetDto,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);

    const set = await this.prisma.exerciseSet.create({
      data: {
        exercise_id: exerciseId,
        set_number: dto.set_number,
        weight: dto.weight ?? null,
        weight_unit: dto.weight_unit ?? 'lbs',
        reps: dto.reps,
        is_completed: true,
      },
    });

    return {
      id: set.id,
      exercise_id: set.exercise_id,
      set_number: set.set_number,
      weight: set.weight ? Number(set.weight) : null,
      weight_unit: set.weight_unit,
      reps: set.reps,
      is_completed: set.is_completed,
      created_at: set.created_at.toISOString(),
    };
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
    dto: UpdateSetDto,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);
    await this.verifySetOwnership(exerciseId, setId);

    const data: any = {};
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.weight_unit !== undefined) data.weight_unit = dto.weight_unit;
    if (dto.reps !== undefined) data.reps = dto.reps;
    if (dto.is_completed !== undefined) data.is_completed = dto.is_completed;

    const set = await this.prisma.exerciseSet.update({
      where: { id: setId },
      data,
    });

    return {
      id: set.id,
      exercise_id: set.exercise_id,
      set_number: set.set_number,
      weight: set.weight ? Number(set.weight) : null,
      weight_unit: set.weight_unit,
      reps: set.reps,
      is_completed: set.is_completed,
      created_at: set.created_at.toISOString(),
    };
  }

  async deleteSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
  ) {
    await this.verifyActiveSession(userId, sessionId);
    await this.verifyExerciseOwnership(sessionId, exerciseId);
    await this.verifySetOwnership(exerciseId, setId);

    await this.prisma.exerciseSet.delete({ where: { id: setId } });

    return { deleted: true };
  }
}
