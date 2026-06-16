import { EQUIPMENT_MAP } from '../common/equipment';

/**
 * What the user's current message is asking for — muscles, equipment,
 * and any specific exercises they named. Drives the library filter so
 * the AI sees a focused slice of the catalog (chest barbell work when
 * they say "gym chest day", bodyweight only when they say "bodyweight
 * push") rather than a flat round-robin over the whole library.
 *
 * Empty-everywhere means a conversational turn ("how about more reps?")
 * or a vague ask ("workout") — the filter then falls back to the
 * onboarding equipment scope and a muscle-balanced sample.
 */
export interface UserIntent {
  /** Canonical lowercase keys: chest, back, legs, shoulders, arms, core. */
  muscleKeywords: string[];
  /** Canonical lowercase keys: barbell, dumbbells, machine, bodyweight, bands, kettlebells. */
  equipmentKeywords: string[];
  /** Library exercise ids that the user named directly (e.g. "do bench press today"). */
  namedExerciseIds: string[];
}

const MUSCLE_KEYWORDS: Record<string, string[]> = {
  chest: ['chest', 'pec'],
  back: ['back', 'lats', 'rhomboid', 'trap'],
  shoulders: ['shoulder', 'delt'],
  arms: ['arms', 'bicep', 'tricep', 'forearm'],
  legs: ['legs', 'leg day', 'quad', 'hamstring', 'glute', 'calves', 'calf'],
  core: ['core', 'abs ', 'abs.', ' abs', 'abs,', 'abdominal', 'oblique'],
  // Cardio is bucketed alongside muscle groups because the library row
  // uses muscle_group="Cardio" for treadmill / bike / row / stairmaster
  // / jump rope entries. Keywords are deliberately specific — bare
  // "row" still resolves to strength (barbell row), but "rowing
  // machine" / "stationary rowing" disambiguates to cardio.
  cardio: [
    'cardio',
    'running',
    'run ',
    'jog',
    'treadmill',
    'elliptical',
    'stairmaster',
    'stair master',
    'stair climber',
    'jump rope',
    'jumprope',
    'skip rope',
    'hiit',
    'conditioning',
    'indoor cycling',
    'stationary bike',
    'exercise bike',
    'recumbent bike',
    'rowing machine',
    'stationary rowing',
  ],
};

const COMPOSITE_KEYWORDS: Array<{ pattern: RegExp; muscles: string[] }> = [
  { pattern: /\bpush(?:\s*(?:day|workout))?\b/, muscles: ['chest', 'shoulders', 'arms'] },
  { pattern: /\bpull(?:\s*(?:day|workout))?\b/, muscles: ['back', 'arms'] },
  { pattern: /\bupper(?:\s*body)?\b/, muscles: ['chest', 'back', 'shoulders', 'arms'] },
  { pattern: /\blower(?:\s*body)?\b/, muscles: ['legs'] },
  { pattern: /\b(?:full|whole|total)\s*body\b/, muscles: ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'] },
];

// Regexes use word-start anchors (`\b`) but allow trailing characters
// so plurals match: "deadlift" / "deadlifts" / "squats" all hit.
const EQUIPMENT_KEYWORDS: Record<string, RegExp[]> = {
  barbell: [/\bbarbell/, /\bbar\s*bell/, /\bdeadlift/, /\bsquat/, /\bbench\s*press/],
  dumbbells: [/\bdumbbell/, /\bdb\b/, /\bdumb\s*bell/],
  machine: [/\bmachine/, /\bcable/, /\bsmith\b/, /\bleg\s*press/, /\bpulldown/],
  bodyweight: [/\bbodyweight/, /\bbody\s*weight/, /\bcalisthenic/, /\bno\s*equipment/, /\bpush[- ]?up/, /\bpull[- ]?up/],
  bands: [/\bbands?\b/, /\bresistance\s*band/],
  kettlebells: [/\bkettlebell/, /\bkb\b/],
};

// "gym" / "full gym" / "commercial gym" implies access to the full kit.
const GYM_PATTERN = /\b(?:gym|full\s*gym|commercial\s*gym|weight\s*room)\b/;

// Common prefixes that distinguish library variants of the same lift
// (e.g. "Barbell Bench Press" vs "Dumbbell Bench Press"). Stripped to
// compute a "core" name for the user-message match — so the user saying
// "bench press" finds all bench variants at once.
const CORE_NAME_PREFIXES = [
  'barbell ',
  'dumbbell ',
  'cable ',
  'machine ',
  'incline ',
  'decline ',
  'flat ',
  'wide ',
  'narrow ',
  'close ',
  'wide-grip ',
  'close-grip ',
  'reverse ',
  'seated ',
  'standing ',
  'lying ',
  'kneeling ',
  'overhead ',
  'single-arm ',
  'one-arm ',
  'one arm ',
  'kettlebell ',
];

function exerciseCoreName(lowerName: string): string {
  let core = lowerName.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of CORE_NAME_PREFIXES) {
      if (core.startsWith(p)) {
        core = core.slice(p.length);
        changed = true;
      }
    }
  }
  return core;
}

/**
 * Extract muscle / equipment / named-exercise signals from the user's
 * current message. Returns empty arrays for conversational or vague
 * turns; the filter treats empty-intent as "no override" and falls
 * back to onboarding equipment + balanced sample.
 */
export function inferUserIntent(
  message: string | null | undefined,
  library: Array<{ id: string; name: string }>,
): UserIntent {
  if (!message || message.trim().length === 0) {
    return { muscleKeywords: [], equipmentKeywords: [], namedExerciseIds: [] };
  }
  // Lowercased + surrounded by spaces so word-boundary regexes work even
  // when the message ends with the keyword.
  const lower = ` ${message.toLowerCase()} `;

  const muscleKeywords = new Set<string>();
  for (const [canonical, keywords] of Object.entries(MUSCLE_KEYWORDS)) {
    for (const k of keywords) {
      if (lower.includes(k)) {
        muscleKeywords.add(canonical);
        break;
      }
    }
  }
  for (const { pattern, muscles } of COMPOSITE_KEYWORDS) {
    if (pattern.test(lower)) muscles.forEach((m) => muscleKeywords.add(m));
  }

  const equipmentKeywords = new Set<string>();
  for (const [canonical, patterns] of Object.entries(EQUIPMENT_KEYWORDS)) {
    if (patterns.some((p) => p.test(lower))) equipmentKeywords.add(canonical);
  }
  if (GYM_PATTERN.test(lower)) {
    ['barbell', 'dumbbells', 'machine', 'bodyweight'].forEach((e) =>
      equipmentKeywords.add(e),
    );
  }

  // Named-exercise extraction. Match against either the full library
  // name OR its "core" form with common equipment/modifier prefixes
  // stripped — so "bench press" in the message catches "Barbell Bench
  // Press" / "Dumbbell Bench Press" / "Incline Bench Press" all at
  // once. 6-char minimum so short words like "row" don't false-match
  // ("tomorrow").
  const namedExerciseIds: string[] = [];
  for (const ex of library) {
    if (!ex.name) continue;
    const lowerName = ex.name.toLowerCase();
    if (lowerName.length >= 6 && lower.includes(lowerName)) {
      namedExerciseIds.push(ex.id);
      continue;
    }
    const core = exerciseCoreName(lowerName);
    if (core.length >= 6 && core !== lowerName && lower.includes(core)) {
      namedExerciseIds.push(ex.id);
    }
  }

  return {
    muscleKeywords: [...muscleKeywords],
    equipmentKeywords: [...equipmentKeywords],
    namedExerciseIds,
  };
}

/**
 * True if `ex.muscle_group` matches the canonical keyword (chest/back/
 * legs/...). The library uses values like "Chest", "Quadriceps",
 * "Lats", so we match against substring patterns rather than exact
 * canonical names.
 */
function muscleMatches(ex: { muscle_group?: string | null }, keyword: string): boolean {
  const mg = (ex.muscle_group ?? '').toLowerCase();
  if (!mg) return false;
  switch (keyword) {
    case 'chest':
      return /chest|pec/.test(mg);
    case 'back':
      return /back|lat|trap|rhomboid/.test(mg);
    case 'shoulders':
      return /shoulder|delt/.test(mg);
    case 'arms':
      return /\barm\b|bicep|tricep|forearm/.test(mg);
    case 'legs':
      return /\bleg|quad|hamstring|glute|calf|adductor|abductor/.test(mg);
    case 'core':
      return /core|abdominal|abs|oblique/.test(mg);
    case 'cardio':
      return mg === 'cardio';
    default:
      return mg.includes(keyword);
  }
}

function equipmentMatches(
  ex: { equipment?: string | null },
  keyword: string,
): boolean {
  const eq = (ex.equipment ?? '').toLowerCase();
  if (!eq) return false;
  switch (keyword) {
    case 'barbell':
      return /barbell/.test(eq);
    case 'dumbbells':
      return /dumbbell/.test(eq);
    case 'machine':
      return /machine|cable/.test(eq);
    case 'bodyweight':
      return /bodyweight|body weight|none/.test(eq);
    case 'bands':
      return /band/.test(eq);
    case 'kettlebells':
      return /kettlebell/.test(eq);
    default:
      return eq.includes(keyword);
  }
}

interface FilterArgs {
  library: Array<any>;
  intent: UserIntent;
  onboarding: any;
  recentLiftIds?: string[];
  /** Max exercises to surface to the AI per turn. */
  cap?: number;
}

/**
 * Pick a focused slice of the library for this turn:
 *
 *   - User-named exercises are ALWAYS included (priority chain).
 *   - If the user message names muscles, restrict to those muscles.
 *   - Equipment scope = user-message equipment if any, else onboarding
 *     equipment (via EQUIPMENT_MAP). "full_gym" maps to empty allowed
 *     set, which means "no equipment filter".
 *   - When the result still exceeds `cap`, balance across muscle
 *     groups round-robin (keep all groups represented).
 *   - Recent-lift exercises score higher so the AI can drive
 *     progression continuity when relevant.
 */
export function filterLibraryForContext(args: FilterArgs): any[] {
  const { library, intent, onboarding } = args;
  const cap = args.cap ?? 120;
  const recentSet = new Set(args.recentLiftIds ?? []);
  const namedSet = new Set(intent.namedExerciseIds);

  // Equipment allowed: user message > onboarding. Empty set = no filter.
  const onboardingAllowed = (
    EQUIPMENT_MAP[onboarding?.available_equipment as string] ?? []
  ).map((e) => e.toLowerCase());
  const equipmentAllowed =
    intent.equipmentKeywords.length > 0
      ? intent.equipmentKeywords
      : onboardingAllowed;

  function passesEquipment(ex: any): boolean {
    if (equipmentAllowed.length === 0) return true;
    return equipmentAllowed.some((e) => equipmentMatches(ex, e));
  }

  function passesMuscle(ex: any): boolean {
    if (intent.muscleKeywords.length === 0) return true;
    return intent.muscleKeywords.some((m) => muscleMatches(ex, m));
  }

  const candidates: any[] = [];
  for (const ex of library) {
    if (namedSet.has(ex.id)) {
      candidates.push(ex);
      continue;
    }
    if (!passesMuscle(ex)) continue;
    if (!passesEquipment(ex)) continue;
    candidates.push(ex);
  }

  // Rank: named > recent > compound > rest. Ties broken by name.
  function score(ex: any): number {
    let s = 0;
    if (namedSet.has(ex.id)) s += 1000;
    if (recentSet.has(ex.id)) s += 50;
    const mechanic = (ex.mechanic ?? '').toLowerCase();
    if (mechanic === 'compound') s += 5;
    if (ex.is_system) s += 1;
    return s;
  }
  candidates.sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  if (candidates.length <= cap) return candidates;

  // Over cap — balance by muscle group round-robin (same shape as the
  // old MAX_EXERCISES sampler but applied AFTER the intent filter).
  // Named + top-scored entries pinned first so high-relevance items
  // never get evicted by the balancer.
  const pinned: any[] = [];
  const balancable: any[] = [];
  for (const c of candidates) {
    if (namedSet.has(c.id) || recentSet.has(c.id)) pinned.push(c);
    else balancable.push(c);
  }

  const byGroup = new Map<string, any[]>();
  for (const ex of balancable) {
    const g = ex.muscle_group ?? 'Other';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(ex);
  }
  const out: any[] = [...pinned];
  const seen = new Set(out.map((e) => e.id));
  const groups = [...byGroup.keys()];
  let idx = 0;
  while (out.length < cap && groups.some((g) => idx < (byGroup.get(g)?.length ?? 0))) {
    for (const g of groups) {
      const arr = byGroup.get(g)!;
      if (idx >= arr.length) continue;
      const candidate = arr[idx];
      if (seen.has(candidate.id)) continue;
      out.push(candidate);
      seen.add(candidate.id);
      if (out.length >= cap) break;
    }
    idx++;
  }
  return out;
}
