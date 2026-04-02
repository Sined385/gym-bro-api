import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { ACCENT_COLORS } from './session-exercise.service';

const IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private generateShareCode(): string {
    return crypto.randomBytes(6).toString('base64url').slice(0, 8);
  }

  private async resolveExerciseImages(
    libraryExerciseIds: string[],
  ): Promise<Map<string, string>> {
    const imageMap = new Map<string, string>();
    if (libraryExerciseIds.length === 0) return imageMap;

    const libraryExercises = await this.prisma.exerciseLibrary.findMany({
      where: { id: { in: libraryExerciseIds } },
      select: { id: true, external_id: true },
    });

    for (const ex of libraryExercises) {
      if (ex.external_id) {
        imageMap.set(ex.id, `${IMAGE_BASE_URL}/${ex.external_id}/0.jpg`);
      }
    }

    return imageMap;
  }

  async createTemplate(userId: string, dto: CreateTemplateDto) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { id: dto.session_id, user_id: userId },
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
        },
      },
    });

    if (!session) {
      throw new AppException(
        'session_not_found',
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!session.exercises || session.exercises.length === 0) {
      throw new AppException(
        'no_exercises',
        'Cannot save a template from a session with no exercises',
        HttpStatus.BAD_REQUEST,
      );
    }

    const exercisesJson = session.exercises.map((e) => ({
      name: e.name,
      muscle_group: e.muscle_group,
      equipment: e.equipment,
      sets_display: e.sets_display,
      library_exercise_id: e.library_exercise_id,
      superset_group_id: e.superset_group_id,
      superset_order: e.superset_order,
    }));

    const template = await this.prisma.workoutTemplate.create({
      data: {
        user_id: userId,
        name: dto.name,
        type: dto.type ?? 'custom',
        exercises_json: exercisesJson,
      },
    });

    const exercises = template.exercises_json as any[];
    const libraryIds = exercises
      .map((e: any) => e.library_exercise_id)
      .filter(Boolean);
    const imageMap = await this.resolveExerciseImages(libraryIds);

    return {
      id: template.id,
      name: template.name,
      type: template.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: imageMap.get(e.library_exercise_id) ?? null,
      })),
      createdAt: template.created_at.toISOString(),
    };
  }

  async listTemplates(userId: string) {
    const templates = await this.prisma.workoutTemplate.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
    });

    const allLibraryIds = templates.flatMap((t) =>
      (t.exercises_json as any[])
        .map((e: any) => e.library_exercise_id)
        .filter(Boolean),
    );
    const imageMap = await this.resolveExerciseImages(allLibraryIds);

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
          imageUrl: imageMap.get(e.library_exercise_id) ?? null,
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
    const libraryIds = exercises
      .map((e: any) => e.library_exercise_id)
      .filter(Boolean);
    const imageMap = await this.resolveExerciseImages(libraryIds);

    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: imageMap.get(e.library_exercise_id) ?? null,
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
    const validIds = new Set<string>();
    if (libraryIds.length > 0) {
      const existing = await this.prisma.exerciseLibrary.findMany({
        where: { id: { in: libraryIds } },
        select: { id: true },
      });
      for (const e of existing) validIds.add(e.id);
    }

    // Re-resolve stale IDs by exercise name from current library
    const nameToLibraryId = new Map<string, string>();
    const staleNames = exercises
      .filter(
        (ex: any) =>
          ex.library_exercise_id && !validIds.has(ex.library_exercise_id),
      )
      .map((ex: any) => ex.name as string);
    if (staleNames.length > 0) {
      const resolved = await this.prisma.exerciseLibrary.findMany({
        where: { name: { in: staleNames }, is_system: true },
        select: { id: true, name: true },
      });
      for (const e of resolved) nameToLibraryId.set(e.name, e.id);
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
            if (
              ex.library_exercise_id &&
              validIds.has(ex.library_exercise_id)
            ) {
              libId = ex.library_exercise_id;
            } else if (ex.name && nameToLibraryId.has(ex.name)) {
              libId = nameToLibraryId.get(ex.name)!;
            }
            return {
              library_exercise_id: libId,
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

    return this.formatSession(session);
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
      this.configService.get<string>('SHARE_DOMAIN') ||
      'https://gyymjaam.com';

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
    const libraryIds = exercises
      .map((e: any) => e.library_exercise_id)
      .filter(Boolean);
    const imageMap = await this.resolveExerciseImages(libraryIds);

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
        imageUrl: imageMap.get(e.library_exercise_id) ?? null,
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
    const libraryIds = exercises
      .map((e: any) => e.library_exercise_id)
      .filter(Boolean);
    const imageMap = await this.resolveExerciseImages(libraryIds);

    return {
      id: newTemplate.id,
      name: newTemplate.name,
      type: newTemplate.type,
      exercises: exercises.map((e: any) => ({
        name: e.name,
        muscleGroup: e.muscle_group,
        equipment: e.equipment,
        setsDisplay: e.sets_display,
        imageUrl: imageMap.get(e.library_exercise_id) ?? null,
      })),
      createdAt: newTemplate.created_at.toISOString(),
    };
  }

  private formatSession(session: {
    id: string;
    user_id: string;
    title: string;
    type: string;
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    duration_minutes: number | null;
    ai_generated: boolean;
    ai_message: string | null;
    created_at: Date;
    updated_at: Date;
    exercises: {
      id: string;
      name: string;
      step_number: number;
      sets_display: string;
      accent_color: string;
      library_exercise_id: string | null;
      muscle_group: string | null;
      equipment: string | null;
      suggested_weight: number | null;
    }[];
  }) {
    return {
      id: session.id,
      user_id: session.user_id,
      title: session.title,
      type: session.type,
      status: session.status,
      started_at: session.started_at?.toISOString() ?? null,
      completed_at: session.completed_at?.toISOString() ?? null,
      duration_minutes: session.duration_minutes,
      ai_generated: session.ai_generated,
      ai_message: session.ai_message,
      created_at: session.created_at.toISOString(),
      updated_at: session.updated_at.toISOString(),
      exercises: session.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        step_number: e.step_number,
        sets_display: e.sets_display,
        accent_color: e.accent_color,
        library_exercise_id: e.library_exercise_id ?? null,
        muscle_group: e.muscle_group ?? null,
        equipment: e.equipment ?? null,
        suggested_weight: e.suggested_weight ?? null,
      })),
    };
  }
}
