-- Mirror of the Prisma migration so the local Supabase stack stays in sync.
-- See prisma/migrations/20260518120000_add_exercise_favorites/migration.sql.

CREATE TABLE IF NOT EXISTS public.exercise_favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS exercise_favorites_user_id_exercise_id_key
    ON public.exercise_favorites (user_id, exercise_id);

CREATE INDEX IF NOT EXISTS exercise_favorites_user_id_created_at_idx
    ON public.exercise_favorites (user_id, created_at DESC);

-- RLS — only the owning user can read/write their own favorites.
-- Aligns with the policy template established for exercise_library.
ALTER TABLE public.exercise_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own favorites" ON public.exercise_favorites;
CREATE POLICY "Users can read their own favorites"
    ON public.exercise_favorites FOR SELECT
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users can insert their own favorites" ON public.exercise_favorites;
CREATE POLICY "Users can insert their own favorites"
    ON public.exercise_favorites FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own favorites" ON public.exercise_favorites;
CREATE POLICY "Users can delete their own favorites"
    ON public.exercise_favorites FOR DELETE
    USING (user_id = auth.uid()::text);
