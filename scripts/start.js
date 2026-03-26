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

// 1. Supabase SQL migrations
run('Supabase migrations', 'node scripts/apply-supabase-migrations.js', 120000);

// 2. Prisma migrations (120s timeout, advisory lock disabled for Supabase pooler)
run('Prisma migrations', 'npx prisma migrate deploy', 120000, {
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
});

// 3. Start the app
console.log('[startup] Starting NestJS app...');
require('../dist/src/main');
