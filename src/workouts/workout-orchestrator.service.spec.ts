import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutOrchestratorService } from './workout-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('WorkoutOrchestratorService', () => {
  let service: WorkoutOrchestratorService;
  let plans: { onSessionCompleted: jest.Mock };
  let analytics: { track: jest.Mock };
  let notifications: { recalculatePreferredHour: jest.Mock };
  let prisma: {
    motivationInsight: { deleteMany: jest.Mock };
    weeklyOverview: { deleteMany: jest.Mock };
    trainingPlan: { findFirst: jest.Mock };
    planDay: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    plans = { onSessionCompleted: jest.fn().mockResolvedValue(undefined) };
    analytics = { track: jest.fn() };
    notifications = {
      recalculatePreferredHour: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      motivationInsight: { deleteMany: jest.fn().mockResolvedValue({}) },
      weeklyOverview: { deleteMany: jest.fn().mockResolvedValue({}) },
      // reconcileWithAdHocSessions returns early when there's no active plan.
      trainingPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      // adaptPlanDayToActualSession returns early when no plan day is
      // linked to the session.
      planDay: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlansService, useValue: plans },
        { provide: AnalyticsService, useValue: analytics },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(WorkoutOrchestratorService);
  });

  it('recordCompletion invokes every post-completion side effect in order', async () => {
    await service.recordCompletion('user-1', 'session-1', {
      durationMinutes: 45,
      calories: 320,
      effortLevel: 7,
    });

    // Cache invalidations
    expect(prisma.motivationInsight.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    });
    expect(prisma.weeklyOverview.deleteMany).toHaveBeenCalled();

    // Plan-domain hook
    expect(plans.onSessionCompleted).toHaveBeenCalledWith('session-1');

    // Analytics
    expect(analytics.track).toHaveBeenCalledWith(
      'user-1',
      'session_completed',
      { duration_minutes: 45, calories: 320, effort_level: 7 },
    );

    // Reminder recalc
    expect(notifications.recalculatePreferredHour).toHaveBeenCalledWith(
      'user-1',
    );
  });
});
