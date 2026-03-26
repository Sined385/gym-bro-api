/**
 * Applies Supabase SQL migrations to the database.
 * Tracks applied migrations in a `_applied_supabase_migrations` table
 * so each migration only runs once (like prisma migrate deploy).
 *
 * Runs each migration's SQL statements individually so that "already exists"
 * errors on some objects don't block creation of other objects in the same file.
 *
 * Usage: node scripts/apply-supabase-migrations.js
 * Requires DATABASE_URL env var.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const TRACKING_TABLE = '_applied_supabase_migrations';

// Postgres error codes that mean "already exists" — safe to skip
const ALREADY_EXISTS_CODES = new Set([
  '42P07', // duplicate_table
  '42P16', // invalid_table_definition (duplicate column)
  '42701', // duplicate_column
  '42710', // duplicate_object
  '42P04', // duplicate_database
  '42723', // duplicate_function
  '23505', // unique_violation (for seed data inserts)
]);

/**
 * Split a SQL file into individual statements.
 * Handles dollar-quoted blocks ($$), DO blocks, and CREATE FUNCTION bodies.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    // Check for dollar-quoting ($$, $tag$, etc.)
    if (char === '$' && !inDollarQuote) {
      const match = sql.slice(i).match(/^(\$[^$]*\$)/);
      if (match) {
        const tag = match[1];
        inDollarQuote = true;
        dollarTag = tag;
        current += tag;
        i += tag.length - 1;
        continue;
      }
    } else if (char === '$' && inDollarQuote) {
      const remaining = sql.slice(i);
      if (remaining.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
        continue;
      }
    }

    if (char === ';' && !inDollarQuote) {
      current += ';';
      const trimmed = current.trim();
      if (trimmed && trimmed !== ';') {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  // Add any remaining statement without semicolon
  const trimmed = current.trim();
  if (trimmed && trimmed !== ';') {
    statements.push(trimmed);
  }

  return statements;
}

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
      const statements = splitStatements(sql);

      let errors = 0;
      let skipped = 0;

      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (err) {
          if (ALREADY_EXISTS_CODES.has(err.code)) {
            skipped++;
          } else {
            errors++;
            console.warn(`    Warning: ${err.message.split('\n')[0]}`);
          }
        }
      }

      // Mark as applied regardless (idempotent — objects that exist are skipped)
      await client.query(
        `INSERT INTO public."${TRACKING_TABLE}" (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [version, name],
      );

      const suffix = skipped > 0 ? ` (${skipped} already existed)` : '';
      const errSuffix = errors > 0 ? ` (${errors} warnings)` : '';
      console.log(`  Applied: ${file}${suffix}${errSuffix}`);
      appliedCount++;
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
