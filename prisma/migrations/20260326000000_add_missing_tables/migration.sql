-- Add missing columns to existing tables
ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "calories" INTEGER;
ALTER TABLE "workout_sessions" ADD COLUMN IF NOT EXISTS "performance_score" INTEGER;
ALTER TABLE "session_exercises" ADD COLUMN IF NOT EXISTS "muscle_group" TEXT;
ALTER TABLE "session_exercises" ADD COLUMN IF NOT EXISTS "equipment" TEXT;
ALTER TABLE "session_exercises" ADD COLUMN IF NOT EXISTS "library_exercise_id" TEXT;
ALTER TABLE "session_exercises" ADD COLUMN IF NOT EXISTS "superset_group_id" TEXT;
ALTER TABLE "session_exercises" ADD COLUMN IF NOT EXISTS "superset_order" TEXT;
ALTER TABLE "onboarding_data" ADD COLUMN IF NOT EXISTS "body_weight_kg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exercise_sets" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "set_number" INTEGER NOT NULL,
    "weight" DECIMAL(65,30),
    "weight_unit" TEXT NOT NULL DEFAULT 'kg',
    "reps" INTEGER NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exercise_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exercise_library" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "muscle_group" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exercise_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "session_feedback" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "effort_level" INTEGER NOT NULL,
    "energy_level" INTEGER NOT NULL,
    "pain_discomfort" TEXT NOT NULL DEFAULT 'None',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "posts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'global',
    "photo_url" TEXT,
    "workout_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "post_likes" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "post_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "friendships" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "addressee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "device_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "session_feedback_session_id_key" ON "session_feedback"("session_id");
CREATE INDEX IF NOT EXISTS "posts_user_id_created_at_idx" ON "posts"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "posts_visibility_created_at_idx" ON "posts"("visibility", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "post_likes_post_id_user_id_key" ON "post_likes"("post_id", "user_id");
CREATE INDEX IF NOT EXISTS "post_comments_post_id_created_at_idx" ON "post_comments"("post_id", "created_at");
CREATE INDEX IF NOT EXISTS "friendships_addressee_id_status_idx" ON "friendships"("addressee_id", "status");
CREATE INDEX IF NOT EXISTS "friendships_requester_id_status_idx" ON "friendships"("requester_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "friendships_requester_id_addressee_id_key" ON "friendships"("requester_id", "addressee_id");
CREATE INDEX IF NOT EXISTS "follows_following_id_idx" ON "follows"("following_id");
CREATE INDEX IF NOT EXISTS "follows_follower_id_idx" ON "follows"("follower_id");
CREATE UNIQUE INDEX IF NOT EXISTS "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");
CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_key" ON "device_tokens"("token");
CREATE INDEX IF NOT EXISTS "device_tokens_user_id_idx" ON "device_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- AddForeignKeys (use DO blocks to skip if they already exist)
DO $$ BEGIN
  ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_library_exercise_id_fkey"
    FOREIGN KEY ("library_exercise_id") REFERENCES "exercise_library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "session_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "session_feedback" ADD CONSTRAINT "session_feedback_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
