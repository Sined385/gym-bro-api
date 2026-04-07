import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { ACCENT_COLORS } from './session-exercise.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { formatSessionResponse } from '../common/format-session';

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private generateShareCode(): string {
    return crypto.randomBytes(6).toString('base64url').slice(0, 8);
  }

  async createTemplate(userId: string, dto: CreateTemplateDto) {
    const ids = dto.session_ids ?? (dto.session_id ? [dto.session_id] : []);

    const sessions = await this.prisma.workoutSession.findMany({
      where: { id: { in: ids }, user_id: userId },
      orderBy: { completed_at: 'asc' },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: { exercise_sets: true },
        },
      },
    });

    if (sessions.length === 0) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const allExercises = sessions.flatMap((s) => s.exercises);

    if (allExercises.length === 0) {
      throw new AppException(
        'no_exercises',
        'Cannot save a template from a session with no exercises',
        HttpStatus.BAD_REQUEST,
      );
    }

    const exercisesJson = allExercises.map((e: any) => {
      let setsDisplay = e.sets_display;
      if (!setsDisplay && e.exercise_sets?.length > 0) {
        const totalSets = e.exercise_sets.length;
        const totalReps = e.exercise_sets.reduce(
          (sum: number, s: any) => sum + s.reps,
          0,
        );
        const repsPerSet = Math.round(totalReps / totalSets);
        setsDisplay = `${totalSets} × ${repsPerSet}`;
      }
      return {
        name: e.name,
        muscle_group: e.muscle_group,
        equipment: e.equipment,
        sets_display: setsDisplay || '',
        library_exercise_id: e.library_exercise_id,
        external_id: e.external_id ?? null,
        superset_group_id: e.superset_group_id,
        superset_order: e.superset_order,
      };
    });

    const template = await this.prisma.workoutTemplate.create({
      data: {
        user_id: userId,
        name: dto.name,
        type: dto.type ?? 'custom',
        exercises_json: exercisesJson,
      },
    });

    const exercises = template.exercises_json as any[];

    return {
      id: template.id,
      name: template.name,
      type: template.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: exerciseImageUrl(e.external_id),
        externalId: e.external_id ?? null,
      })),
      createdAt: template.created_at.toISOString(),
    };
  }

  async listTemplates(userId: string) {
    const templates = await this.prisma.workoutTemplate.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
    });

    return templates.map((template) => {
      const exercises = template.exercises_json as any[];
      return {
        id: template.id,
        name: template.name,
        type: template.type,
        exercises: exercises.map((e: any) => ({
          name: e.name,
          muscleGroup: e.muscle_group,
          equipment: e.equipment,
          setsDisplay: e.sets_display,
          imageUrl: exerciseImageUrl(e.external_id),
          externalId: e.external_id ?? null,
        })),
        createdAt: template.created_at.toISOString(),
      };
    });
  }

  async updateTemplate(userId: string, id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.workoutTemplate.findFirst({
      where: { id, user_id: userId },
    });

    if (!template) {
      throw new AppException(
        'template_not_found',
        'Template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.workoutTemplate.update({
      where: { id },
      data: { name: dto.name },
    });

    const exercises = updated.exercises_json as any[];

    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: exerciseImageUrl(e.external_id),
        externalId: e.external_id ?? null,
      })),
      createdAt: updated.created_at.toISOString(),
    };
  }

  async deleteTemplate(userId: string, id: string) {
    const template = await this.prisma.workoutTemplate.findFirst({
      where: { id, user_id: userId },
    });

    if (!template) {
      throw new AppException(
        'template_not_found',
        'Template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.workoutTemplate.delete({ where: { id } });

    return { deleted: true };
  }

  async startFromTemplate(userId: string, templateId: string) {
    const template = await this.prisma.workoutTemplate.findFirst({
      where: { id: templateId, user_id: userId },
    });

    if (!template) {
      throw new AppException(
        'template_not_found',
        'Template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const exercises = template.exercises_json as any[];

    // Validate library_exercise_ids still exist (seed script regenerates UUIDs on deploy)
    const libraryIds = exercises
      .map((ex: any) => ex.library_exercise_id)
      .filter((id: string | null): id is string => !!id);
    const validLibExercises = new Map<
      string,
      { id: string; external_id: string | null }
    >();
    if (libraryIds.length > 0) {
      const existing = await this.prisma.exerciseLibrary.findMany({
        where: { id: { in: libraryIds } },
        select: { id: true, external_id: true },
      });
      for (const e of existing)
        validLibExercises.set(e.id, {
          id: e.id,
          external_id: e.external_id,
        });
    }

    // Re-resolve stale IDs by exercise name from current library
    const nameToLibExercise = new Map<
      string,
      { id: string; external_id: string | null }
    >();
    const staleNames = exercises
      .filter(
        (ex: any) =>
          ex.library_exercise_id &&
          !validLibExercises.has(ex.library_exercise_id),
      )
      .map((ex: any) => ex.name as string);
    if (staleNames.length > 0) {
      const resolved = await this.prisma.exerciseLibrary.findMany({
        where: { name: { in: staleNames }, is_system: true },
        select: { id: true, name: true, external_id: true },
      });
      for (const e of resolved)
        nameToLibExercise.set(e.name, {
          id: e.id,
          external_id: e.external_id,
        });
    }

    // Create WorkoutSession + SessionExercise rows
    const session = await this.prisma.workoutSession.create({
      data: {
        user_id: userId,
        title: template.name,
        type: template.type,
        status: 'proposed',
        ai_generated: false,
        updated_at: new Date(),
        exercises: {
          create: exercises.map((ex: any, i: number) => {
            let libId: string | null = null;
            let externalId: string | null = ex.external_id ?? null;
            if (
              ex.library_exercise_id &&
              validLibExercises.has(ex.library_exercise_id)
            ) {
              const libEx = validLibExercises.get(ex.library_exercise_id)!;
              libId = libEx.id;
              externalId = libEx.external_id ?? externalId;
            } else if (ex.name && nameToLibExercise.has(ex.name)) {
              const libEx = nameToLibExercise.get(ex.name)!;
              libId = libEx.id;
              externalId = libEx.external_id ?? externalId;
            }
            return {
              library_exercise_id: libId,
              external_id: externalId,
              name: ex.name,
              muscle_group: ex.muscle_group,
              equipment: ex.equipment ?? null,
              step_number: i + 1,
              sets_display: ex.sets_display || '3 × 10',
              accent_color: ACCENT_COLORS[i % ACCENT_COLORS.length],
              superset_group_id: ex.superset_group_id ?? null,
              superset_order: ex.superset_order ?? null,
            };
          }),
        },
      },
      include: { exercises: { orderBy: { step_number: 'asc' } } },
    });

    return formatSessionResponse(session);
  }

  async shareTemplate(userId: string, templateId: string) {
    const template = await this.prisma.workoutTemplate.findFirst({
      where: { id: templateId, user_id: userId },
    });

    if (!template) {
      throw new AppException(
        'template_not_found',
        'Template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    let shareCode = template.share_code;
    if (!shareCode) {
      shareCode = this.generateShareCode();
      await this.prisma.workoutTemplate.update({
        where: { id: templateId },
        data: { share_code: shareCode },
      });
    }

    const shareDomain =
      this.configService.get<string>('SHARE_DOMAIN') || 'https://gyymjaam.com';

    return {
      shareUrl: `${shareDomain}/s/${shareCode}`,
      shareCode,
    };
  }

  async getSharedTemplate(code: string) {
    const template = await this.prisma.workoutTemplate.findFirst({
      where: { share_code: code },
    });

    if (!template) {
      throw new AppException(
        'template_not_found',
        'Shared template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const [creator, onboarding, followerCount, followingCount] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: template.user_id },
          select: {
            id: true,
            full_name: true,
            username: true,
            avatar_url: true,
          },
        }),
        this.prisma.onboardingData.findUnique({
          where: { user_id: template.user_id },
          select: {
            primary_goals: true,
            experience_level: true,
            body_weight_kg: true,
          },
        }),
        this.prisma.follow.count({
          where: { following_id: template.user_id },
        }),
        this.prisma.follow.count({
          where: { follower_id: template.user_id },
        }),
      ]);

    const exercises = template.exercises_json as any[];

    return {
      name: template.name,
      shareCode: template.share_code,
      creator: creator
        ? {
            id: creator.id,
            name: creator.full_name,
            username: creator.username,
            avatarUrl: creator.avatar_url,
            primaryGoals: onboarding?.primary_goals ?? [],
            experienceLevel: onboarding?.experience_level ?? null,
            bodyWeightKg: onboarding?.body_weight_kg ?? null,
            followerCount,
            followingCount,
          }
        : null,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: exerciseImageUrl(e.external_id),
        externalId: e.external_id ?? null,
      })),
    };
  }

  async saveSharedTemplate(userId: string, code: string) {
    const source = await this.prisma.workoutTemplate.findFirst({
      where: { share_code: code },
    });

    if (!source) {
      throw new AppException(
        'template_not_found',
        'Shared template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const newTemplate = await this.prisma.workoutTemplate.create({
      data: {
        user_id: userId,
        name: source.name,
        type: source.type,
        exercises_json: source.exercises_json as any,
      },
    });

    const exercises = newTemplate.exercises_json as any[];

    return {
      id: newTemplate.id,
      name: newTemplate.name,
      type: newTemplate.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: exerciseImageUrl(e.external_id),
        externalId: e.external_id ?? null,
      })),
      createdAt: newTemplate.created_at.toISOString(),
    };
  }
}
