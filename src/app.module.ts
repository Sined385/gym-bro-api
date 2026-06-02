import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { HomeModule } from './home/home.module';
import { ExercisesModule } from './exercises/exercises.module';
import { CoachModule } from './coach/coach.module';
import { PlansModule } from './plans/plans.module';
import { OpenAIModule } from './openai/openai.module';
import { CommunityModule } from './community/community.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { UserModule } from './user/user.module';
import { ShareModule } from './share/share.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { AuthThrottlerGuard } from './common/guards/auth-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', limit: 60, ttl: 60_000 }],
    }),
    PrismaModule,
    SupabaseModule,
    OpenAIModule,
    AuthModule,
    OnboardingModule,
    HomeModule,
    ExercisesModule,
    CoachModule,
    PlansModule,
    WorkoutsModule,
    CommunityModule,
    NotificationsModule,
    AnalyticsModule,
    UserModule,
    ShareModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthThrottlerGuard }],
})
export class AppModule {}
