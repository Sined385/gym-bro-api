/**
 * Generate Ukrainian translations for the system exercise catalog.
 *
 * Reads data/exercises.json, applies the SAME filter the seed script
 * keeps (no stretching, only the shipped cardio set, no foam roll),
 * and batch-translates the names via OpenAI. Results are merged into
 * data/exercise-names.uk.json keyed by external_id (the entry `id`);
 * the seed script then copies them into exercise_library.name_uk.
 *
 * Idempotent: entries already present in the JSON are skipped, so
 * re-running only translates catalog additions.
 *
 * Usage:
 *   npx ts-node scripts/generate-exercise-name-translations.ts
 *   npx ts-node scripts/generate-exercise-name-translations.ts --force
 *   npx ts-node scripts/generate-exercise-name-translations.ts --only <external_id>
 */
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Keep in sync with ALLOWED_CARDIO in scripts/seed-exercise-library.ts
// (and AVAILABLE_CARDIO_EXTERNAL_IDS in src/common/exercise-set-synth.ts).
const ALLOWED_CARDIO = new Set([
  'Bicycling_Stationary',
  'Elliptical_Trainer',
  'Jogging_Treadmill',
  'Recumbent_Bike',
  'Rope_Jumping',
  'Rowing_Stationary',
  'Running_Treadmill',
  'Stairmaster',
  'Walking_Treadmill',
]);

const BATCH_SIZE = 40;

interface RawExercise {
  id: string;
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  category: string;
}

function parseArgs(): { force: boolean; only: string | null } {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? (args[onlyIdx + 1] ?? null) : null;
  if (onlyIdx !== -1 && !only) {
    throw new Error('--only requires an external_id argument');
  }
  return { force, only };
}

async function translateBatch(
  openai: OpenAI,
  batch: RawExercise[],
): Promise<Map<string, string>> {
  // Muscle/equipment context disambiguates gym homonyms (e.g. "Fly",
  // "Pull Through") — but results map back by EXACT English name so
  // the model can't drift the keys.
  const itemLines = batch
    .map(
      (e) =>
        `${e.name} [muscles: ${(e.primaryMuscles ?? []).join(',')}; equipment: ${e.equipment ?? 'none'}]`,
    )
    .join('\n');

  const systemPrompt = `You are a professional Ukrainian strength & conditioning translator for a gym app.
Translate the following English exercise names into natural, professional Ukrainian gym terminology (as used by Ukrainian coaches: жим, тяга, присідання, розведення, підтягування, випади...).
Rules:
- Keep proper nouns and named techniques recognizable: 'Smith Machine' → «Сміт-машина» / «у Сміт-машині», 'Zercher' → «Зерхер», person names stay transliterated, not translated.
- The bracketed [muscles: ...; equipment: ...] part is CONTEXT ONLY — do not include it in the translation.
- Translate every listed name. Output keys must be the exact English name as given (without the bracketed context).
Respond with a JSON object of the form {"translations": {"<english name>": "<ukrainian>"}}.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: itemLines },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty OpenAI response');
  const parsed = JSON.parse(content) as {
    translations?: Record<string, string>;
  };
  const map = new Map<string, string>();
  for (const [name, translation] of Object.entries(parsed.translations ?? {})) {
    if (typeof translation === 'string' && translation.trim().length > 0) {
      map.set(name, translation.trim());
    }
  }
  return map;
}

async function main() {
  const { force, only } = parseArgs();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const dataDir = path.join(__dirname, '..', 'data');
  const raw: RawExercise[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'exercises.json'), 'utf-8'),
  );

  // Same catalog filter as scripts/seed-exercise-library.ts — no point
  // paying for translations of rows the seed never ships.
  const filtered = raw.filter((e) => {
    if (e.category === 'stretching') return false;
    if (e.category === 'cardio' && !ALLOWED_CARDIO.has(e.id)) return false;
    if (e.equipment === 'foam roll') return false;
    return true;
  });

  const outPath = path.join(dataDir, 'exercise-names.uk.json');
  const existing: Record<string, string> = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, 'utf-8'))
    : {};

  let pending = filtered.filter((e) => force || !existing[e.id]);
  if (only) {
    pending = filtered.filter((e) => e.id === only);
    if (pending.length === 0) {
      throw new Error(
        `external_id "${only}" not found in the filtered catalog`,
      );
    }
  }

  console.log(
    `Catalog: ${filtered.length} exercises after filtering (${raw.length} total); ${pending.length} to translate, ${filtered.length - pending.length} already done`,
  );

  let translated = 0;
  let missed = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    const batchTotal = Math.ceil(pending.length / BATCH_SIZE);
    process.stdout.write(
      `Batch ${batchNo}/${batchTotal} (${batch.length} names)... `,
    );
    const byName = await translateBatch(openai, batch);
    let batchHits = 0;
    for (const entry of batch) {
      const translation = byName.get(entry.name);
      if (translation) {
        existing[entry.id] = translation;
        translated++;
        batchHits++;
      } else {
        missed++;
        console.warn(
          `\n  MISSING translation for "${entry.name}" (${entry.id})`,
        );
      }
    }
    console.log(`${batchHits}/${batch.length} ok`);

    // Write after every batch — a crash mid-run keeps its progress and
    // the next run only pays for what's left.
    const sorted = Object.fromEntries(
      Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
  }

  console.log(
    `Done: ${translated} translated this run, ${missed} missed, ${Object.keys(existing).length} total in ${path.basename(outPath)}`,
  );
  if (missed > 0) {
    console.log('Re-run the script to retry the missed names.');
  }
}

main().catch((err) => {
  console.error('Translation generation failed:', err);
  process.exit(1);
});
