import {
  coachLanguageInstruction,
  languageInstruction,
  resolveLang,
  t,
} from './i18n';

describe('resolveLang', () => {
  it('resolves uk from a full locale header (uk-UA)', () => {
    expect(resolveLang('uk-UA')).toBe('uk');
  });

  it('resolves uk from an Accept-Language list', () => {
    expect(resolveLang('uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk');
  });

  it('falls back to persisted uk when no header is present', () => {
    expect(resolveLang(undefined, 'uk')).toBe('uk');
  });

  it('defaults to en', () => {
    expect(resolveLang()).toBe('en');
    expect(resolveLang(undefined, null)).toBe('en');
    expect(resolveLang(undefined, 'de')).toBe('en');
  });

  it('an explicit non-uk header wins over persisted uk', () => {
    expect(resolveLang('en-US', 'uk')).toBe('en');
  });

  it('handles array header values (first entry wins)', () => {
    expect(resolveLang(['uk-UA', 'en-US'])).toBe('uk');
    expect(resolveLang(['en-US', 'uk-UA'])).toBe('en');
  });
});

describe('languageInstruction', () => {
  it('is empty for en — English prompts stay byte-identical', () => {
    expect(languageInstruction('en')).toBe('');
  });

  it('is non-empty for uk and pins JSON keys/exercise names to English', () => {
    const instruction = languageInstruction('uk');
    expect(instruction).toContain('Ukrainian');
    expect(instruction).toContain('українською');
    expect(instruction).toContain('English');
  });
});

describe('coachLanguageInstruction', () => {
  it('defaults ambiguity to English for en users', () => {
    expect(coachLanguageInstruction('en')).toContain('default to English');
  });

  it('defaults ambiguity to Ukrainian for uk users', () => {
    expect(coachLanguageInstruction('uk')).toContain('default to Ukrainian');
  });
});

describe('t', () => {
  // Snapshot guard: en output must equal the EXACT legacy strings that
  // shipped before i18n. If one of these fails, English users' UX
  // changed — that is a regression, not a translation update.
  it('en strings match the legacy hardcoded values', () => {
    expect(t('en', 'coach.error.rate_limit')).toBe(
      'Coach is at capacity right now. Give it a few seconds and try again.',
    );
    expect(t('en', 'coach.error.generic')).toBe(
      'Something went wrong with the AI. Try again in a moment.',
    );
    expect(t('en', 'coach.limit_reached')).toBe(
      "You've used all 20 free messages. Upgrade to Premium for unlimited AI coaching.",
    );
    expect(t('en', 'promo.not_found')).toBe(
      "This code doesn't exist. Double-check the spelling.",
    );
    expect(t('en', 'plans.makeup_session')).toBe('Make-up Session');
    expect(t('en', 'plans.part_of_week', { week: 3 })).toBe(
      'Part of your Week 3 training plan',
    );
    expect(t('en', 'plans.template.upper_body_power')).toBe('Upper Body Power');
    expect(t('en', 'home.welcome_title')).toBe('Welcome to GymJam');
    expect(t('en', 'home.welcome_message', { goal: 'building muscle' })).toBe(
      'Your profile is set up and ready for building muscle. Start your first workout to get personalized insights.',
    );
    expect(
      t('en', 'home.sessions_remaining', {
        completed: 2,
        target: 4,
        remaining: 2,
      }),
    ).toBe('2/4 sessions done this week. 2 remaining to stay on track.');
    expect(t('en', 'home.sessions_target_met', { target: 3 })).toBe(
      '3/3 sessions done. Weekly target met — consider adding volume or intensity.',
    );
    expect(t('en', 'home.todays_session')).toBe("Today's Session");
    expect(
      t('en', 'home.quick_workout_fallback_message', { goal: 'strength' }),
    ).toBe(
      "I built a balanced strength session based on your profile and available equipment. Let's go!",
    );
    expect(
      t('en', 'home.overview.no_history', {
        count: 1,
        workoutWord: 'workout',
        volume: '1,200',
      }),
    ).toBe(
      '1 workout this week, 1,200 kg total volume. Not enough history for comparison yet.',
    );
    expect(t('en', 'push.skip1_body', { days: 5 })).toBe(
      "5 days without a workout — your muscles are waiting. Let's go!",
    );
    expect(t('en', 'push.d2_title')).toBe('Your first workout awaits!');
  });

  it('interpolates every occurrence of a placeholder', () => {
    // {target} appears twice in sessions_target_met.
    expect(t('en', 'home.sessions_target_met', { target: 5 })).toContain(
      '5/5 sessions done',
    );
  });

  it('returns Ukrainian text for uk', () => {
    expect(t('uk', 'home.welcome_title')).toBe('Вітаємо в GymJam');
    expect(t('uk', 'plans.makeup_session')).toBe('Компенсаційне тренування');
  });
});
