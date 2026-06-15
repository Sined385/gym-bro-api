import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutOrchestratorService } from './workout-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('WorkoutOrchestratorService', () => {
  let service: WorkoutOrchestratorService;
  let plans: { onSessionCompleted: jest.Mock; generatePlan: jest.Mock };
  let analytics: { track: jest.Mock };
  let notifications: { recalculatePreferredHour: jest.Mock };
  let prisma: {
    motivationInsight: { deleteMany: jest.Mock };
    weeklyOverview: { deleteMany: jest.Mock };
    trainingPlan: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    planDay: { findFirst: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    plans = {
      onSessionCompleted: jest.fn().mockResolvedValue(undefined),
      generatePlan: jest.fn().mockResolvedValue({ planId: 'new-plan' }),
    };
    analytics = { track: jest.fn() };
    notifications = {
      recalculatePreferredHour: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      motivationInsight: { deleteMany: jest.fn().mockResolvedValue({}) },
      weeklyOverview: { deleteMany: jest.fn().mockResolvedValue({}) },
      trainingPlan: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      planDay: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
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

  describe('ensureCurrentWeek', () => {
    it('no-ops when there is no active plan', async () => {
      prisma.trainingPlan.findFirst.mockResolvedValueOnce(null);
      await service.ensureCurrentWeek('user-1');
      expect(prisma.trainingPlan.update).not.toHaveBeenCalled();
      expect(plans.generatePlan).not.toHaveBeenCalled();
    });

    it('no-ops when the active plan is still within its week', async () => {
      // week_start_date is right now → weekEnd is 7 days out → check passes (still current).
      prisma.trainingPlan.findFirst.mockResolvedValueOnce({
        id: 'plan-current',
        week_start_date: new Date(),
      });
      await service.ensureCurrentWeek('user-1');
      expect(prisma.trainingPlan.update).not.toHaveBeenCalled();
      expect(plans.generatePlan).not.toHaveBeenCalled();
    });

    it('deactivates the stale plan and regenerates without the premium gate', async () => {
      // 10 days ago — well past the 7-day weekEnd.
      const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.trainingPlan.findFirst.mockResolvedValueOnce({
        id: 'plan-stale',
        week_start_date: stale,
      });
      await service.ensureCurrentWeek('user-1');

      // FK-clearing sweep on plan_days that pointed at sessions.
      expect(prisma.planDay.updateMany).toHaveBeenCalledWith({
        where: {
          plan_id: 'plan-stale',
          workout_session_id: { not: null },
        },
        data: { workout_session_id: null },
      });
      // Stale plan deactivated.
      expect(prisma.trainingPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-stale' },
        data: { is_active: false },
      });
      // Critical contract: regen is called with force=false, which
      // means the premium gate in generatePlan is skipped. System-
      // initiated week rollovers must not paywall non-premium users.
      expect(plans.generatePlan).toHaveBeenCalledWith('user-1', false);
    });
  });
});
