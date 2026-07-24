-- Persisted app language ('en' | 'uk') so background jobs (crons,
-- plan generation) can localize without a request context.
ALTER TABLE "User" ADD COLUMN "language" TEXT;
