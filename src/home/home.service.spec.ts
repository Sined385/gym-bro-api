import { Test, TestingModule } from '@nestjs/testing';
import { HomeService } from './home.service';
import { PrismaService } from '../prisma/prisma.service';
import { HomeAiService } from './home-ai.service';

const mockPrisma = {
  workoutSession: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockHomeAiService = {
  getOrGenerateMotivation: jest.fn(),
  generateQuickWorkout: jest.fn(),
};

describe('HomeService', () => {
  let service: HomeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HomeAiService, useValue: mockHomeAiService },
      ],
    }).compile();

    service = module.get<HomeService>(HomeService);
    jest.clearAllMocks();
  });

  describe('getSessionHistory', () => {
    it('should return formatted session with exercises and sets', async () => {
      const mockSession = {
        id: 'session-1',
        user_id: 'user-1',
        title: "Mon's Session",
        type: 'strength',
        status: 'completed',
        started_at: new Date('2026-03-11T08:00:00Z'),
        completed_at: new Date('2026-03-11T08:52:00Z'),
        duration_minutes: 52,
        calories: 385,
        performance_score: 87,
        ai_generated: false,
        ai_message: null,
        created_at: new Date(),
        updated_at: new Date(),
        exercises: [
          {
            id: 'ex-1',
            session_id: 'session-1',
            name: 'Barbell Bench Press',
            step_number: 1,
            sets_display: '4x8',
            muscle_group: 'Chest',
            accent_color: '#E86A75',
            exercise_sets: [
              {
                set_number: 1,
                weight: 185,
                weight_unit: 'lbs',
                reps: 8,
              },
              {
                set_number: 2,
                weight: 185,
                weight_unit: 'lbs',
                reps: 8,
              },
            ],
          },
          {
            id: 'ex-2',
            session_id: 'session-1',
            name: 'Pull-ups',
            step_number: 2,
            sets_display: '3x10',
            muscle_group: 'Back',
            accent_color: '#E86A75',
            exercise_sets: [
              {
                set_number: 1,
                weight: null,
                weight_unit: 'lbs',
                reps: 12,
              },
            ],
          },
        ],
      };

      mockPrisma.workoutSession.findFirst.mockResolvedValue(mockSession);

      const result = await service.getSessionHistory('user-1', '2026-03-11');

      expect(result.date).toBe('2026-03-11');
      expect(result.session).not.toBeNull();
      expect(result.session!.id).toBe('session-1');
      expect(result.session!.calories).toBe(385);
      expect(result.session!.performance_score).toBe(87);
      expect(result.session!.exercises).toHaveLength(2);

      // First exercise gets first accent color
      expect(result.session!.exercises[0].accent_color).toBe('#E86A75');
      expect(result.session!.exercises[0].muscle_group).toBe('Chest');
      expect(result.session!.exercises[0].sets).toHaveLength(2);
      expect(result.session!.exercises[0].sets[0].weight).toBe(185);

      // Second exercise gets second accent color
      expect(result.session!.exercises[1].accent_color).toBe('#30C08D');
      expect(result.session!.exercises[1].sets[0].weight).toBeNull();
    });

    it('should return null session when no completed session exists', async () => {
      mockPrisma.workoutSession.findFirst.mockResolvedValue(null);

      const result = await service.getSessionHistory('user-1', '2026-03-12');

      expect(result).toEqual({ date: '2026-03-12', session: null });
    });
  });

  describe('getCompletedDays', () => {
    it('should return array of unique date strings', async () => {
      mockPrisma.workoutSession.findMany.mockResolvedValue([
        { completed_at: new Date('2026-01-22T10:00:00Z') },
        { completed_at: new Date('2026-01-22T18:00:00Z') },
        { completed_at: new Date('2026-01-25T09:00:00Z') },
      ]);

      const result = await service.getCompletedDays('user-1', '2026-01');

      expect(result.month).toBe('2026-01');
      expect(result.completed_dates).toEqual(['2026-01-22', '2026-01-25']);
    });

    it('should return empty array when no sessions exist', async () => {
      mockPrisma.workoutSession.findMany.mockResolvedValue([]);

      const result = await service.getCompletedDays('user-1', '2026-02');

      expect(result).toEqual({ month: '2026-02', completed_dates: [] });
    });
  });
});
