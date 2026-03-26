/**
 * Applies Supabase SQL migrations to the database.
 * Tracks applied migrations in a `_applied_supabase_migrations` table
 * so each migration only runs once (like prisma migrate deploy).
 *
 * Usage: node scripts/apply-supabase-migrations.js
 * Requires DATABASE_URL env var.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const TRACKING_TABLE = '_applied_supabase_migrations';

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set — skipping Supabase migrations');
    process.exit(0);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Create tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS public."${TRACKING_TABLE}" (
        version TEXT PRIMARY KEY,
        name TEXT,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Get already-applied migrations
    const { rows } = await client.query(
      `SELECT version FROM public."${TRACKING_TABLE}" ORDER BY version`,
    );
    const applied = new Set(rows.map((r) => r.version));

    // Read migration files in order
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('No supabase/migrations directory found — skipping');
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;

    for (const file of files) {
      const version = file.split('_')[0];
      const name = file.replace('.sql', '');

      if (applied.has(version)) {
        console.log(`  Skip: ${file} (already applied)`);
        continue;
      }

      console.log(`  Applying: ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public."${TRACKING_TABLE}" (version, name) VALUES ($1, $2)`,
          [version, name],
        );
        await client.query('COMMIT');
        console.log(`  Applied: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAILED: ${file} — ${err.message}`);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('Supabase migrations: all up to date');
    } else {
      console.log(`Supabase migrations: ${appliedCount} applied successfully`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Supabase migration runner failed:', err.message);
  process.exit(1);
});
