-- Mirror of the Prisma migration for the local Supabase stack.
-- See prisma/migrations/20260518180000_add_post_share_config/migration.sql.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS share_config JSONB;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS card_image_url TEXT;
