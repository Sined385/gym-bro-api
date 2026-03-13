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
      primary_goal,
      primary_sport,
      experience_level,
      training_frequency,
      workout_duration,
      available_equipment,
      injuries,
      completed_at,
    } = dto;

    if (!PRIMARY_GOALS.includes(primary_goal)) {
      throw new AppException(
        'invalid_primary_goal',
        `primary_goal must be one of: ${PRIMARY_GOALS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (primary_sport.trim().length === 0) {
      throw new AppException(
        'invalid_primary_sport',
        'primary_sport must be a non-empty string',
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

    if (!EQUIPMENT_OPTIONS.includes(available_equipment)) {
      throw new AppException(
        'invalid_equipment',
        `available_equipment must be one of: ${EQUIPMENT_OPTIONS.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const validatedInjuries = this.normalizeInjuries(injuries);

    const data = {
      primary_goal,
      primary_sport: primary_sport.trim(),
      experience_level,
      training_frequency,
      workout_duration,
      available_equipment,
      injuries: validatedInjuries as unknown as InputJsonValue,
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
    primary_goal: string;
    primary_sport: string;
    experience_level: string;
    training_frequency: number;
    workout_duration: number;
    available_equipment: string;
    injuries: unknown;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }) {
    return {
      id: record.id,
      user_id: record.user_id,
      primary_goal: record.primary_goal,
      primary_sport: record.primary_sport,
      experience_level: record.experience_level,
      training_frequency: record.training_frequency,
      workout_duration: record.workout_duration,
      available_equipment: record.available_equipment,
      injuries: record.injuries ?? [],
      completed_at: record.completed_at?.toISOString() ?? null,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    };
  }
}
