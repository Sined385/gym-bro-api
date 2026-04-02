-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "estimated_cost" DECIMAL(10,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_user_id_created_at_idx" ON "ai_usage"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_usage_feature_created_at_idx" ON "ai_usage"("feature", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage"("created_at" DESC);
