-- CreateTable
CREATE TABLE "exercise_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exercise_favorites_user_id_exercise_id_key" ON "exercise_favorites"("user_id", "exercise_id");

-- CreateIndex
CREATE INDEX "exercise_favorites_user_id_created_at_idx" ON "exercise_favorites"("user_id", "created_at" DESC);
