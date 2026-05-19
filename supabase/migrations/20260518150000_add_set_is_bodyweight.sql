-- Mirror of the Prisma migration for the local Supabase stack.
-- See prisma/migrations/20260518150000_add_set_is_bodyweight/migration.sql.
ALTER TABLE public.exercise_sets ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT false;
