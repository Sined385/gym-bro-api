-- Mirror of the Prisma migration so the local Supabase stack stays in sync.
-- See prisma/migrations/20260520113048_add_shared_cards/migration.sql.

CREATE TABLE IF NOT EXISTS public.shared_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    card_image_url TEXT NOT NULL,
    share_config JSONB,
    workout_session_id TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS shared_cards_user_id_created_at_idx
    ON public.shared_cards (user_id, created_at DESC);

-- RLS — owner controls writes; public read so the unauthenticated /c/:id
-- HTML route can render the page for link recipients (parallel to the
-- visibility='global' carve-out for posts on /p/:id).
ALTER TABLE public.shared_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read shared cards" ON public.shared_cards;
CREATE POLICY "Anyone can read shared cards"
    ON public.shared_cards FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can insert their own shared cards" ON public.shared_cards;
CREATE POLICY "Users can insert their own shared cards"
    ON public.shared_cards FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own shared cards" ON public.shared_cards;
CREATE POLICY "Users can delete their own shared cards"
    ON public.shared_cards FOR DELETE
    USING (user_id = auth.uid()::text);
