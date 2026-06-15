import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutOrchestratorService } from './workout-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionService } from '../subscription/subscription.service';

describe('WorkoutOrchestratorService', () => {
  let service: WorkoutOrchestratorService;
  let plans: { onSessionCompleted: jest.Mock; generatePlan: jest.Mock };
  let analytics: { track: jest.Mock };
  let notifications: { recalculatePreferredHour: jest.Mock };
  let subscription: { isPremium: jest.Mock };
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
    // Default premium: false. Individual tests override per case.
    subscription = { isPremium: jest.fn().mockResolvedValue(false) };
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
        { provide: SubscriptionService, useValue: subscription },
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

    it('non-premium → deterministic fallback (no OpenAI tokens spent)', async () => {
      const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.trainingPlan.findFirst.mockResolvedValueOnce({
        id: 'plan-stale',
        week_start_date: stale,
      });
      subscription.isPremium.mockResolvedValueOnce(false);
      await service.ensureCurrentWeek('user-1');

      expect(prisma.planDay.updateMany).toHaveBeenCalledWith({
        where: {
          plan_id: 'plan-stale',
          workout_session_id: { not: null },
        },
        data: { workout_session_id: null },
      });
      expect(prisma.trainingPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-stale' },
        data: { is_active: false },
      });
      // Critical: force=false (premium gate skipped) AND
      // forceFallback=true (no AI call). Free user gets a fresh
      // current-week plan from the deterministic template path.
      expect(plans.generatePlan).toHaveBeenCalledWith(
        'user-1',
        false,
        undefined,
        { forceFallback: true },
      );
    });

    it('premium → AI regen (forceFallback=false)', async () => {
      const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.trainingPlan.findFirst.mockResolvedValueOnce({
        id: 'plan-stale',
        week_start_date: stale,
      });
      subscription.isPremium.mockResolvedValueOnce(true);
      await service.ensureCurrentWeek('user-1');

      expect(plans.generatePlan).toHaveBeenCalledWith(
        'user-1',
        false,
        undefined,
        { forceFallback: false },
      );
    });

    it('falls back to template when subscription lookup throws', async () => {
      // Subscription service failures should not block plan
      // generation. Defaulting to "not premium" is the safe path —
      // we never spend tokens we can't verify the user paid for.
      const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.trainingPlan.findFirst.mockResolvedValueOnce({
        id: 'plan-stale',
        week_start_date: stale,
      });
      subscription.isPremium.mockRejectedValueOnce(new Error('upstream down'));
      await service.ensureCurrentWeek('user-1');

      expect(plans.generatePlan).toHaveBeenCalledWith(
        'user-1',
        false,
        undefined,
        { forceFallback: true },
      );
    });
  });
});
