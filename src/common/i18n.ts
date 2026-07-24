/**
 * Ukrainian localization support.
 *
 * Two categories of localized output:
 *   1. AI-generated text — steered via a language instruction appended
 *      to the system prompt (`languageInstruction` /
 *      `coachLanguageInstruction`). JSON keys, enum values, and
 *      exercise names must stay in English because iOS and the DB
 *      match on them exactly.
 *   2. Deterministic server strings (fallback titles, push texts,
 *      promo errors) — via the `t()` table below.
 *
 * English behavior is byte-identical to pre-i18n: for 'en',
 * `languageInstruction` returns '' and `t()` returns the exact legacy
 * strings.
 */

export type Lang = 'en' | 'uk';

/**
 * Resolve the effective language for a request.
 *
 * Header wins (it reflects the device's CURRENT setting); the
 * persisted User.language is the fallback for contexts without a
 * request (crons, background generation). Only the primary tag
 * matters — 'uk-UA', 'uk;q=0.9' etc. all resolve to 'uk'.
 */
export function resolveLang(
  headerValue?: string | string[],
  persisted?: string | null,
): Lang {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (raw) {
    // Accept-Language style: take the first (primary) tag.
    const primary = raw.split(',')[0]?.trim().toLowerCase() ?? '';
    if (primary.startsWith('uk')) return 'uk';
    // A non-uk header is an explicit signal — don't fall back to the
    // persisted value, the device says it wants something else.
    return 'en';
  }
  if (persisted === 'uk') return 'uk';
  return 'en';
}

/**
 * Prompt suffix for one-shot AI generations (plans, motivation,
 * summaries). '' for English keeps every existing prompt byte-identical.
 */
export function languageInstruction(lang: Lang): string {
  if (lang !== 'uk') return '';
  return '\n\nLANGUAGE: Write ALL user-visible text (titles, messages, notes, summaries, verdicts) in Ukrainian (українською). JSON keys, enum values, muscle_group and equipment values, and exercise names referenced from any provided list MUST remain exactly as given in English.';
}

/**
 * Prompt suffix for coach chat. Returned for BOTH languages — it's
 * behavior-neutral for English users (default stays English) and lets
 * bilingual users switch language mid-conversation naturally.
 */
export function coachLanguageInstruction(lang: Lang): string {
  return `\n\nLANGUAGE: Reply in the language of the user's most recent message. If ambiguous, default to ${lang === 'uk' ? 'Ukrainian' : 'English'}. Workout titles and card content follow that same language. JSON/tool-call keys, enum values, and exercise names stay in English exactly as given.`;
}

// ── Deterministic strings ───────────────────────────────────────────

export type StringKey =
  // Coach AI error messages (common/ai-error.ts)
  | 'coach.error.rate_limit'
  | 'coach.error.timeout'
  | 'coach.error.content_filter'
  | 'coach.error.auth'
  | 'coach.error.upstream'
  | 'coach.error.generic'
  // Coach free-tier limit (coach/coach.service.ts)
  | 'coach.limit_reached'
  // Promo redemption failures (subscription/promo.service.ts)
  | 'promo.not_found'
  | 'promo.expired'
  | 'promo.deactivated'
  | 'promo.already_redeemed'
  | 'promo.premium_conflict'
  // Plans (plans/plans.service.ts)
  | 'plans.makeup_session'
  | 'plans.part_of_week'
  // Fallback plan template titles (plans/plans-ai.service.ts)
  | 'plans.template.upper_body_power'
  | 'plans.template.lower_body_strength'
  | 'plans.template.push_day'
  | 'plans.template.pull_day'
  | 'plans.template.full_body'
  | 'plans.template.upper_hypertrophy'
  | 'plans.template.lower_hypertrophy'
  // Home motivation fallbacks (home/home-ai.service.ts)
  | 'home.welcome_title'
  | 'home.welcome_message'
  | 'home.weekly_status_title'
  | 'home.sessions_remaining'
  | 'home.sessions_target_met'
  | 'home.goal.build_muscle'
  | 'home.goal.lose_fat'
  | 'home.goal.get_stronger'
  | 'home.goal.improve_endurance'
  | 'home.goal.stay_healthy'
  | 'home.goal.generic'
  // Quick-workout fallbacks (home/home-ai.service.ts)
  | 'home.todays_session'
  | 'home.quick_workout_ai_message'
  | 'home.quick_workout_fallback_message'
  | 'home.goal_label.build_muscle'
  | 'home.goal_label.lose_fat'
  | 'home.goal_label.get_stronger'
  | 'home.goal_label.improve_endurance'
  | 'home.goal_label.stay_healthy'
  | 'home.goal_label.generic'
  // Weekly-overview fallback (home/home-ai.service.ts)
  | 'home.overview.workout_singular'
  | 'home.overview.workout_plural'
  | 'home.overview.no_history'
  | 'home.overview.with_history'
  // Push notifications (notifications/notifications.cron.ts)
  | 'push.skip1_title'
  | 'push.skip1_body'
  | 'push.skip2_title'
  | 'push.skip2_body'
  | 'push.skip3_title'
  | 'push.skip3_body'
  | 'push.skip4_title'
  | 'push.skip4_body'
  | 'push.skip5_title'
  | 'push.skip5_body'
  | 'push.d2_title'
  | 'push.d2_body';

// English values are the EXACT legacy strings — snapshot-tested in
// i18n.spec.ts so localization can never drift the en experience.
const STRINGS: Record<StringKey, Record<Lang, string>> = {
  'coach.error.rate_limit': {
    en: 'Coach is at capacity right now. Give it a few seconds and try again.',
    uk: 'Тренер зараз перевантажений. Зачекайте кілька секунд і спробуйте ще раз.',
  },
  'coach.error.timeout': {
    en: 'Coach took too long to respond. Try sending that again.',
    uk: 'Тренер надто довго не відповідає. Спробуйте надіслати повідомлення ще раз.',
  },
  'coach.error.content_filter': {
    en: "I can't respond to that message. Try rephrasing.",
    uk: 'Я не можу відповісти на це повідомлення. Спробуйте переформулювати.',
  },
  'coach.error.auth': {
    en: 'Coach is misconfigured server-side. Please report this.',
    uk: 'Тренер неправильно налаштований на сервері. Будь ласка, повідомте про це.',
  },
  'coach.error.upstream': {
    en: 'Coach is having trouble talking to the AI. Try again in a moment.',
    uk: 'Тренер не може зв’язатися з ШІ. Спробуйте ще раз за хвилину.',
  },
  'coach.error.generic': {
    en: 'Something went wrong with the AI. Try again in a moment.',
    uk: 'Щось пішло не так із ШІ. Спробуйте ще раз за хвилину.',
  },
  'coach.limit_reached': {
    en: "You've used all 20 free messages. Upgrade to Premium for unlimited AI coaching.",
    uk: 'Ви використали всі 20 безкоштовних повідомлень. Оформіть Premium для необмеженого ШІ-коучингу.',
  },
  'promo.not_found': {
    en: "This code doesn't exist. Double-check the spelling.",
    uk: 'Такого коду не існує. Перевірте правильність написання.',
  },
  'promo.expired': {
    en: 'This code has expired.',
    uk: 'Термін дії цього коду минув.',
  },
  'promo.deactivated': {
    en: 'This code is no longer active.',
    uk: 'Цей код більше не активний.',
  },
  'promo.already_redeemed': {
    en: "You've already used this code.",
    uk: 'Ви вже використали цей код.',
  },
  'promo.premium_conflict': {
    en: 'You already have an active subscription.',
    uk: 'У вас уже є активна підписка.',
  },
  'plans.makeup_session': {
    en: 'Make-up Session',
    uk: 'Компенсаційне тренування',
  },
  'plans.part_of_week': {
    en: 'Part of your Week {week} training plan',
    uk: 'Частина вашого плану тренувань, тиждень {week}',
  },
  'plans.template.upper_body_power': {
    en: 'Upper Body Power',
    uk: 'Сила верху тіла',
  },
  'plans.template.lower_body_strength': {
    en: 'Lower Body Strength',
    uk: 'Сила ніг',
  },
  'plans.template.push_day': {
    en: 'Push Day',
    uk: 'День жимів',
  },
  'plans.template.pull_day': {
    en: 'Pull Day',
    uk: 'День тяг',
  },
  'plans.template.full_body': {
    en: 'Full Body',
    uk: 'Все тіло',
  },
  'plans.template.upper_hypertrophy': {
    en: 'Upper Hypertrophy',
    uk: 'Гіпертрофія верху',
  },
  'plans.template.lower_hypertrophy': {
    en: 'Lower Hypertrophy',
    uk: 'Гіпертрофія ніг',
  },
  'home.welcome_title': {
    en: 'Welcome to GymJam',
    uk: 'Вітаємо в GymJam',
  },
  'home.welcome_message': {
    en: 'Your profile is set up and ready for {goal}. Start your first workout to get personalized insights.',
    uk: 'Ваш профіль налаштовано — усе готово для цілі «{goal}». Розпочніть перше тренування, щоб отримати персональні поради.',
  },
  'home.weekly_status_title': {
    en: 'Weekly status',
    uk: 'Статус тижня',
  },
  'home.sessions_remaining': {
    en: '{completed}/{target} sessions done this week. {remaining} remaining to stay on track.',
    uk: '{completed}/{target} тренувань виконано цього тижня. Залишилося {remaining}, щоб триматися графіка.',
  },
  'home.sessions_target_met': {
    en: '{target}/{target} sessions done. Weekly target met — consider adding volume or intensity.',
    uk: '{target}/{target} тренувань виконано. Тижневу ціль досягнуто — спробуйте додати обсяг або інтенсивність.',
  },
  'home.goal.build_muscle': {
    en: 'building muscle',
    uk: 'набір м’язової маси',
  },
  'home.goal.lose_fat': {
    en: 'burning fat',
    uk: 'спалювання жиру',
  },
  'home.goal.get_stronger': {
    en: 'getting stronger',
    uk: 'розвиток сили',
  },
  'home.goal.improve_endurance': {
    en: 'boosting endurance',
    uk: 'покращення витривалості',
  },
  'home.goal.stay_healthy': {
    en: 'staying healthy',
    uk: 'підтримка здоров’я',
  },
  'home.goal.generic': {
    en: 'your fitness goals',
    uk: 'ваші фітнес-цілі',
  },
  'home.todays_session': {
    en: "Today's Session",
    uk: 'Тренування на сьогодні',
  },
  'home.quick_workout_ai_message': {
    en: 'A workout tailored just for you!',
    uk: 'Тренування, підібране саме для вас!',
  },
  'home.quick_workout_fallback_message': {
    en: "I built a balanced {goal} session based on your profile and available equipment. Let's go!",
    uk: 'Я склав збалансоване тренування ({goal}) на основі вашого профілю та доступного обладнання. Вперед!',
  },
  'home.goal_label.build_muscle': {
    en: 'muscle building',
    uk: 'набір м’язів',
  },
  'home.goal_label.lose_fat': {
    en: 'fat loss',
    uk: 'спалювання жиру',
  },
  'home.goal_label.get_stronger': {
    en: 'strength',
    uk: 'сила',
  },
  'home.goal_label.improve_endurance': {
    en: 'endurance',
    uk: 'витривалість',
  },
  'home.goal_label.stay_healthy': {
    en: 'general fitness',
    uk: 'загальна форма',
  },
  'home.goal_label.generic': {
    en: 'fitness',
    uk: 'фітнес',
  },
  'home.overview.workout_singular': {
    en: 'workout',
    uk: 'тренування',
  },
  'home.overview.workout_plural': {
    en: 'workouts',
    uk: 'тренувань',
  },
  'home.overview.no_history': {
    en: '{count} {workoutWord} this week, {volume} kg total volume. Not enough history for comparison yet.',
    uk: '{count} {workoutWord} цього тижня, {volume} кг загального обсягу. Поки що замало історії для порівняння.',
  },
  'home.overview.with_history': {
    en: '{count} {workoutWord} this week, {volume} kg total volume. Previous 3-week average: {prevWorkouts} workouts, {prevVolume} kg volume.',
    uk: '{count} {workoutWord} цього тижня, {volume} кг загального обсягу. Середнє за попередні 3 тижні: {prevWorkouts} тренувань, {prevVolume} кг обсягу.',
  },
  'push.skip1_title': {
    en: "Don't lose your gains! 💪",
    uk: 'Не втрачайте прогрес! 💪',
  },
  'push.skip1_body': {
    en: "{days} days without a workout — your muscles are waiting. Let's go!",
    uk: '{days} днів без тренування — ваші м’язи чекають. Вперед!',
  },
  'push.skip2_title': {
    en: 'Your gains miss you 🏋️',
    uk: 'Ваші м’язи скучили 🏋️',
  },
  'push.skip2_body': {
    en: "It's been {days} days. One session is all it takes to get back on track!",
    uk: 'Минуло вже {days} днів. Одне тренування — і ви знову в графіку!',
  },
  'push.skip3_title': {
    en: 'Rest day streak? 😅',
    uk: 'Серія днів відпочинку? 😅',
  },
  'push.skip3_body': {
    en: '{days} days off — time to break the streak and break a sweat!',
    uk: '{days} днів перерви — час перервати серію і добряче пропотіти!',
  },
  'push.skip4_title': {
    en: 'Time to get back at it 🔥',
    uk: 'Час повертатися до справи 🔥',
  },
  'push.skip4_body': {
    en: '{days} days since your last session. Your future self will thank you!',
    uk: '{days} днів з останнього тренування. Майбутній ви скаже вам дякую!',
  },
  'push.skip5_title': {
    en: 'Consistency beats perfection 🎯',
    uk: 'Регулярність важливіша за ідеальність 🎯',
  },
  'push.skip5_body': {
    en: '{days} days is long enough — even a quick session keeps the momentum going!',
    uk: '{days} днів — це вже достатньо. Навіть коротке тренування підтримає темп!',
  },
  'push.d2_title': {
    en: 'Your first workout awaits!',
    uk: 'Ваше перше тренування чекає!',
  },
  'push.d2_body': {
    en: 'Check out your personalized plan and crush your first session',
    uk: 'Перегляньте персональний план і проведіть перше тренування на повну',
  },
};

/**
 * Translate a deterministic string. `{param}` placeholders interpolate
 * from `params`; unknown placeholders are left as-is (visible in QA
 * rather than silently swallowed).
 */
export function t(
  lang: Lang,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  let out = STRINGS[key][lang];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}
