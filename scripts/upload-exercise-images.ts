/**
 * One-time-ish: upload every exercise's 0.jpg + 1.jpg from the local
 * `exercises/` working copy to a public Supabase Storage bucket named
 * `exercise-images`. Path layout matches the previous github URLs so
 * the only client/server change is the base URL — paths under
 * `exercise-images/<external_id>/{0,1}.jpg` line up 1:1 with what the
 * old IMAGE_BASE_URL pointed at.
 *
 * Idempotent: each upload uses upsert=true. Re-running is safe (and
 * cheap — Supabase's content-MD5 check is fast).
 *
 * Setup before running:
 *   1. In the Supabase dashboard, create a PUBLIC bucket named
 *      "exercise-images" (no auth required for read).
 *   2. Make sure SUPABASE_URL and SUPABASE_KEY (service_role key) are
 *      set in .env — same env vars the API uses.
 *
 * Run:  npx ts-node scripts/upload-exercise-images.ts
 *
 * Flags:
 *   --dry-run   Walk the directory and report counts without uploading.
 *   --limit=N   Upload only the first N exercises (smoke test).
 *   --concurrency=N  Parallel uploads (default 10).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const BUCKET = 'exercise-images';
// Sibling repo to gym-bro-api — the local working copy of gym-bro-exercises.
const EXERCISES_DIR = path.resolve(__dirname, '..', '..', 'exercises', 'exercises');
const FRAMES = ['0.jpg', '1.jpg'];

interface CliFlags {
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let concurrency = 10;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--limit=')) limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) concurrency = Number(arg.split('=')[1]);
  }
  return { dryRun, limit, concurrency };
}

async function main() {
  const flags = parseFlags();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in .env');
  }
  if (!fs.existsSync(EXERCISES_DIR)) {
    throw new Error(
      `Exercises directory not found at ${EXERCISES_DIR}. Clone gym-bro-exercises as a sibling repo first.`,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Walk every exercise folder, pair it with its 0.jpg + 1.jpg.
  const entries = fs.readdirSync(EXERCISES_DIR, { withFileTypes: true });
  const exerciseDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  console.log(`Found ${exerciseDirs.length} exercise directories in ${EXERCISES_DIR}`);

  const work: { externalId: string; frame: string; localPath: string }[] = [];
  let missingFrames = 0;
  for (const externalId of exerciseDirs) {
    for (const frame of FRAMES) {
      const localPath = path.join(EXERCISES_DIR, externalId, frame);
      if (!fs.existsSync(localPath)) {
        missingFrames++;
        continue;
      }
      work.push({ externalId, frame, localPath });
    }
  }
  if (missingFrames > 0) {
    console.log(`Skipped ${missingFrames} missing frames (exercise dir without 0.jpg / 1.jpg).`);
  }

  const planned = flags.limit ? work.slice(0, flags.limit) : work;
  console.log(`Planning to upload ${planned.length} files (${flags.dryRun ? 'DRY RUN' : 'live'}).`);

  if (flags.dryRun) {
    console.log('Sample:', planned.slice(0, 3));
    return;
  }

  // Confirm the bucket exists. createBucket is a no-op if it's already there.
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    console.log(`Creating public bucket "${BUCKET}"…`);
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
    });
    if (error) throw new Error(`createBucket failed: ${error.message}`);
  } else {
    console.log(`Bucket "${BUCKET}" already exists.`);
  }

  // Concurrency-limited fan-out. Pool pattern — each worker pulls from
  // a shared cursor instead of awaiting per-batch barriers.
  let cursor = 0;
  let uploaded = 0;
  let failed = 0;
  const failures: { externalId: string; frame: string; error: string }[] = [];

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= planned.length) return;
      const { externalId, frame, localPath } = planned[i];
      const remotePath = `${externalId}/${frame}`;
      try {
        const buf = fs.readFileSync(localPath);
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(remotePath, buf, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (error) {
          failed++;
          failures.push({ externalId, frame, error: error.message });
        } else {
          uploaded++;
        }
      } catch (e: any) {
        failed++;
        failures.push({ externalId, frame, error: e?.message ?? String(e) });
      }
      if ((uploaded + failed) % 100 === 0) {
        console.log(`  …${uploaded + failed}/${planned.length} (${uploaded} ok, ${failed} fail)`);
      }
    }
  }

  const workers = Array.from({ length: flags.concurrency }, () => worker());
  await Promise.all(workers);

  console.log(`\nDone. Uploaded ${uploaded}, failed ${failed}.`);
  if (failures.length > 0) {
    console.log('First 10 failures:');
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.externalId}/${f.frame}: ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error('upload-exercise-images failed:', err);
  process.exit(1);
});
