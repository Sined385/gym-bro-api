/**
 * Railway startup script.
 * Runs Supabase migrations, then Prisma migrations (with timeout), then starts the app.
 */

const { execSync } = require('child_process');

function run(label, command, timeoutMs = 30000) {
  console.log(`[startup] ${label}...`);
  try {
    execSync(command, { stdio: 'inherit', timeout: timeoutMs });
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
run('Supabase migrations', 'node scripts/apply-supabase-migrations.js', 60000);

// 2. Prisma migrations (disable advisory lock for Supabase pooler, 30s timeout)
process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = '1';
run('Prisma migrations', 'npx prisma migrate deploy', 30000);

// 3. Start the app (replaces this process)
console.log('[startup] Starting NestJS app...');
require('../dist/src/main');
