-- CreateTable
CREATE TABLE "onboarding_data" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "primary_goal" TEXT NOT NULL,
    "primary_sport" TEXT NOT NULL,
    "experience_level" TEXT NOT NULL,
    "training_frequency" INTEGER NOT NULL,
    "workout_duration" INTEGER NOT NULL,
    "available_equipment" TEXT NOT NULL,
    "injuries" JSONB NOT NULL DEFAULT '[]',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_data_user_id_key" ON "onboarding_data"("user_id");
