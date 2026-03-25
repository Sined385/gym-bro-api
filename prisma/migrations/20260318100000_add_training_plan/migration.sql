-- CreateTable
CREATE TABLE "training_plans" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL DEFAULT 1,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "plan_days" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "day_type" TEXT NOT NULL,
    "session_title" TEXT,
    "session_type" TEXT,
    "muscle_groups" TEXT[],
    "exercises_json" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "workout_session_id" UUID,
    "ai_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_days_workout_session_id_key" ON "plan_days"("workout_session_id");

-- AddForeignKey
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_workout_session_id_fkey" FOREIGN KEY ("workout_session_id") REFERENCES "workout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
