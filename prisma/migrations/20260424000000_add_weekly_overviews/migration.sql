-- CreateTable
CREATE TABLE "weekly_overviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "overview" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_overviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_overviews_user_id_week_start_key" ON "weekly_overviews"("user_id", "week_start");
