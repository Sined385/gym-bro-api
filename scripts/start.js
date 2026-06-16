/**
 * Railway startup script.
 * Runs Supabase migrations, then Prisma migrations, then starts the app.
 */

const { execSync } = require('child_process');

function run(label, command, timeoutMs = 60000, extraEnv = {}) {
  console.log(`[startup] ${label}...`);
  try {
    execSync(command, {
      stdio: 'inherit',
      timeout: timeoutMs,
      env: { ...process.env, ...extraEnv },
    });
    console.log(`[startup] ${label} — done`);
  } catch (err) {
    if (err.killed) {
      console.error(`[startup] ${label} — timed out after ${timeoutMs / 1000}s, skipping`);
    } else {
      console.error(`[startup] ${label} — failed (exit code ${err.status}), skipping`);
    }
  }
}

// One-time bandage: analytics_events was originally created by a Supabase
// migration before its Prisma counterpart existed, so prod's _prisma_migrations
// doesn't have the row. We mark it as applied so `migrate deploy` doesn't try
// to re-create the table. Brand-new databases (staging, future envs) execute
// this as a no-op once they're past it. Remove when prod gets baselined.
run(
  'Resolve analytics_events migration',
  'npx prisma migrate resolve --applied 20260330000000_add_analytics_events',
  30000,
  { PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1' },
);

// 1. Prisma migrations (creates all tables)
run('Prisma migrations', 'npx prisma migrate deploy', 120000, {
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
});

// 2. Supabase SQL migrations (adds RLS policies, seed data, storage buckets)
run('Supabase migrations', 'node scripts/apply-supabase-migrations.js', 120000);

// 3. Seed exercise library (with external_id for images). The script is
//    .ts and tsconfig.build deliberately excludes scripts/ from the dist
//    output, so we run it through ts-node. ts-node + typescript are
//    installed in the runtime image alongside prisma — see Dockerfile.
run(
  'Seed exercise library',
  'npx ts-node scripts/seed-exercise-library.ts',
  120000,
);

// 4. Start the app
console.log('[startup] Starting NestJS app...');
require('../dist/src/main');
