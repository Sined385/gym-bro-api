-- Add metadata columns to exercise_library for the free-exercise-db integration
ALTER TABLE public.exercise_library ADD COLUMN IF NOT EXISTS "external_id" TEXT;
ALTER TABLE public.exercise_library ADD COLUMN IF NOT EXISTS "level" TEXT;
ALTER TABLE public.exercise_library ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE public.exercise_library ADD COLUMN IF NOT EXISTS "force" TEXT;
ALTER TABLE public.exercise_library ADD COLUMN IF NOT EXISTS "mechanic" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_library_external_id_key" ON public.exercise_library("external_id");
