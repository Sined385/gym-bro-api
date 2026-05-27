import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { AnalyticsService } from '../analytics/analytics.service';

export type ChallengeCategory = 'physical' | 'mental';

export interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  icon: string; // SF Symbol name
  category: ChallengeCategory;
}

/**
 * Curated catalog. IDs are stable — if a challenge is retired, remove it from
 * this list but keep historical `daily_challenge_completions` rows intact.
 */
const CATALOG: ChallengeDefinition[] = [
  { id: 'water_glass', title: 'Drink a glass of water', description: 'Hydration matters — even one extra glass helps.', icon: 'drop.fill', category: 'physical' },
  { id: 'walk_5min', title: 'Take a 5-minute walk', description: 'Get your blood flowing for a few minutes.', icon: 'figure.walk', category: 'physical' },
  { id: 'stretch_2min', title: 'Stretch for 2 minutes', description: 'Loosen up — neck, shoulders, hips.', icon: 'figure.flexibility', category: 'physical' },
  { id: 'stairs', title: 'Take the stairs', description: 'Skip the elevator once today.', icon: 'figure.stairs', category: 'physical' },
  { id: 'pushups_10', title: 'Do 10 push-ups', description: 'A quick strength snack — anywhere works.', icon: 'figure.strengthtraining.traditional', category: 'physical' },
  { id: 'stand_break', title: 'Stand and move for 1 minute', description: 'Break up sitting — get the legs going.', icon: 'figure.stand', category: 'physical' },
  { id: 'breaths_5', title: 'Take 5 deep breaths', description: 'Reset your nervous system in a minute.', icon: 'wind', category: 'mental' },
  { id: 'gratitude_3', title: 'List 3 things you’re grateful for', description: 'Quick gratitude shifts the day.', icon: 'heart.text.square', category: 'mental' },
  { id: 'screen_break_5', title: 'Take a 5-minute screen break', description: 'Rest your eyes and look at something far away.', icon: 'eye.slash', category: 'mental' },
  { id: 'mindfulness_2min', title: '2 minutes of mindfulness', description: 'Sit still, notice your breath, come back.', icon: 'brain.head.profile', category: 'mental' },
  { id: 'fresh_air', title: 'Step outside for fresh air', description: 'A short outdoor moment resets focus.', icon: 'leaf', category: 'mental' },
  { id: 'kind_message', title: 'Send someone a kind message', description: 'A small note to a friend goes a long way.', icon: 'bubble.left.and.bubble.right', category: 'mental' },
];

@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Returns today's challenge for a user with completion state attached. */
  async getDailyChallenge(userId: string, now: Date = new Date()) {
    const today = startOfDay(now);
    return this.findForDay(userId, today);
  }

  /**
   * Returns tomorrow's challenge (always uncompleted). The iOS client uses
   * this to populate the body of the locally-scheduled push notification
   * so the user sees the real challenge text on the notification.
   */
  async getTomorrowChallenge(userId: string, now: Date = new Date()) {
    const tomorrow = startOfDay(new Date(now.getTime() + 86400000));
    const pick = pickDailyForUser(userId, tomorrow);
    return {
      id: pick.id,
      title: pick.title,
      description: pick.description,
      icon: pick.icon,
      category: pick.category,
      completed: false,
    };
  }

  /**
   * Marks today's challenge complete. Idempotent. Rejects if the id isn't
   * today's pick — prevents the client from completing arbitrary catalog
   * entries.
   */
  async complete(userId: string, challengeId: string, now: Date = new Date()) {
    const today = startOfDay(now);
    const pick = pickDailyForUser(userId, today);

    if (pick.id !== challengeId) {
      throw new AppException(
        'challenge_not_active',
        "That challenge is not today's challenge",
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.dailyChallengeCompletion.upsert({
      where: {
        user_id_challenge_id_date: {
          user_id: userId,
          challenge_id: challengeId,
          date: today,
        },
      },
      create: { user_id: userId, challenge_id: challengeId, date: today },
      update: {},
    });

    this.analytics.track(userId, 'daily_challenge_completed', {
      challenge_id: challengeId,
    });

    return this.findForDay(userId, today);
  }

  private async findForDay(userId: string, day: Date) {
    const pick = pickDailyForUser(userId, day);
    const completion = await this.prisma.dailyChallengeCompletion.findUnique({
      where: {
        user_id_challenge_id_date: {
          user_id: userId,
          challenge_id: pick.id,
          date: day,
        },
      },
      select: { id: true },
    });
    return {
      id: pick.id,
      title: pick.title,
      description: pick.description,
      icon: pick.icon,
      category: pick.category,
      completed: completion !== null,
    };
  }
}

// ── Deterministic per user × day selection ───────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / 86400000);
}

function pickDailyForUser(userId: string, day: Date): ChallengeDefinition {
  const seed = hashString(`${userId}:${dayIndex(day)}`);
  const rng = mulberry32(seed);
  const idx = Math.floor(rng() * CATALOG.length);
  return CATALOG[idx];
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
