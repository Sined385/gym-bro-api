import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { InputJsonValue } from '@prisma/client/runtime/client';
import type { OnboardingData } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SaveOnboardingDto, InjuryDto } from './dto/onboarding.dto';

const PRIMARY_GOALS = [
  'build_muscle',
  'lose_fat',
  'recomposition',
  'improve_endurance',
  'general_fitness',
];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const WORKOUT_DURATIONS = [30, 45, 60, 90];
const REST_TIMES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
const EQUIPMENT_OPTIONS = [
  'full_gym',
  'dumbbells_only',
  'bodyweight',
  'home_gym',
];

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, dto: SaveOnboardingDto) {
    const {
      experience_level,
      training_frequency,
      workout_duration,
      preferred_rest_time,
      available_equipment,
      injuries,
      weight_kg,
      height_cm,
      biological_sex,
      ai_coach_context,
      completed_at,
    } = dto;

    // Normalize: accept both singular (primary_goal) and plural (primary_goals) formats
    const goals =
      dto.primary_goals ?? (dto.primary_goal ? [dto.primary_goal] : []);
    const sports =
      dto.primary_sports ?? (dto.primary_sport ? [dto.primary_sport] : []);

    if (goals.length === 0 || !goals.every((g) => PRIMARY_GOALS.includes(g))) {
      throw new AppException(
        'invalid_primary_goals',
        `primary_goal(s) must be one of: ${PRIMARY_GOALS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      sports.length === 0 ||
      !sports.every((s) => typeof s === 'string' && s.trim().length > 0)
    ) {
      throw new AppException(
        'invalid_primary_sports',
        'primary_sport(s) must be a non-empty string',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!EXPERIENCE_LEVELS.includes(experience_level)) {
      throw new AppException(
        'invalid_experience_level',
        `experience_level must be one of: ${EXPERIENCE_LEVELS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !Number.isInteger(training_frequency) ||
      training_frequency < 1 ||
      training_frequency > 7
    ) {
      throw new AppException(
        'invalid_training_frequency',
        'training_frequency must be between 1 and 7',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!WORKOUT_DURATIONS.includes(workout_duration)) {
      throw new AppException(
        'invalid_workout_duration',
        `workout_duration must be one of: ${WORKOUT_DURATIONS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      preferred_rest_time !== undefined &&
      !REST_TIMES.includes(preferred_rest_time)
    ) {
      throw new AppException(
        'invalid_rest_time',
        `preferred_rest_time must be one of: ${REST_TIMES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!EQUIPMENT_OPTIONS.includes(available_equipment)) {
      throw new AppException(
        'invalid_equipment',
        `available_equipment must be one of: ${EQUIPMENT_OPTIONS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (ai_coach_context !== undefined && ai_coach_context.length > 500) {
      throw new AppException(
        'invalid_ai_coach_context',
        'ai_coach_context must be 500 characters or fewer',
        HttpStatus.BAD_REQUEST,
      );
    }

    const validatedInjuries = this.normalizeInjuries(injuries);

    const data = {
      primary_goals: goals,
      primary_sports: sports.map((s) => s.trim()),
      experience_level,
      training_frequency,
      workout_duration,
      ...(preferred_rest_time !== undefined && { preferred_rest_time }),
      available_equipment,
      injuries: validatedInjuries as unknown as InputJsonValue,
      ...(weight_kg !== undefined && { body_weight_kg: weight_kg }),
      ...(height_cm !== undefined && { height_cm }),
      ...(biological_sex !== undefined && { biological_sex }),
      ...(ai_coach_context !== undefined && { ai_coach_context }),
      completed_at: new Date(completed_at),
      updated_at: new Date(),
    };

    const record: OnboardingData = await this.prisma.onboardingData.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...data },
      update: data,
    });

    return this.formatRecord(record);
  }

  async findByUserId(userId: string) {
    const record = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });
    return record ? this.formatRecord(record) : null;
  }

  async getStatus(userId: string) {
    const record = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
      select: { completed_at: true },
    });
    return { has_completed_onboarding: !!record?.completed_at };
  }

  async patchField(userId: string, body: Record<string, any>) {
    const data: Record<string, any> = {};

    if (body.preferred_rest_time !== undefined) {
      if (!REST_TIMES.includes(body.preferred_rest_time)) {
        throw new AppException(
          'invalid_rest_time',
          `preferred_rest_time must be one of: ${REST_TIMES.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      data.preferred_rest_time = body.preferred_rest_time;
    }

    if (body.ai_coach_context !== undefined) {
      if (typeof body.ai_coach_context !== 'string' || body.ai_coach_context.length > 500) {
        throw new AppException(
          'invalid_ai_coach_context',
          'ai_coach_context must be a string with 500 characters or fewer',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Empty string clears the field; otherwise store as-is.
      data.ai_coach_context = body.ai_coach_context.length === 0 ? null : body.ai_coach_context;
    }

    if (Object.keys(data).length === 0) {
      throw new AppException(
        'no_fields',
        'No valid fields to update',
        HttpStatus.BAD_REQUEST,
      );
    }

    data.updated_at = new Date();

    const record = await this.prisma.onboardingData.update({
      where: { user_id: userId },
      data,
    });

    return this.formatRecord(record);
  }

  async delete(userId: string) {
    const record = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!record) {
      throw new NotFoundException();
    }
    await this.prisma.onboardingData.delete({ where: { user_id: userId } });
  }

  private normalizeInjuries(injuries: InjuryDto[] | undefined): InjuryDto[] {
    if (!injuries || injuries.length === 0) return [];

    if (injuries.some((i) => i.type === 'none')) {
      return [{ type: 'none', value: 'None' }];
    }

    return injuries;
  }

  private formatRecord(record: {
    id: string;
    user_id: string;
    primary_goals: string[];
    primary_sports: string[];
    experience_level: string;
    training_frequency: number;
    workout_duration: number;
    preferred_rest_time: number | null;
    available_equipment: string;
    injuries: unknown;
    body_weight_kg?: number | null;
    ai_coach_context?: string | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }) {
    return {
      id: record.id,
      user_id: record.user_id,
      primary_goals: record.primary_goals,
      primary_sports: record.primary_sports,
      experience_level: record.experience_level,
      training_frequency: record.training_frequency,
      workout_duration: record.workout_duration,
      preferred_rest_time: record.preferred_rest_time,
      available_equipment: record.available_equipment,
      injuries: record.injuries ?? [],
      body_weight_kg: record.body_weight_kg ?? null,
      ai_coach_context: record.ai_coach_context ?? null,
      completed_at: record.completed_at?.toISOString() ?? null,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    };
  }
}
