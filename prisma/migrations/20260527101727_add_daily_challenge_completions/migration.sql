-- CreateTable
CREATE TABLE "daily_challenge_completions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_challenge_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_challenge_completions_user_id_challenge_id_date_key" ON "daily_challenge_completions"("user_id", "challenge_id", "date");

-- CreateIndex
CREATE INDEX "daily_challenge_completions_user_id_date_idx" ON "daily_challenge_completions"("user_id", "date");
