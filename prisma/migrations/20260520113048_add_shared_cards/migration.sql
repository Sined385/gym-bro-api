-- CreateTable: standalone shareable card links (decoupled from posts).
CREATE TABLE "shared_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "card_image_url" TEXT NOT NULL,
    "share_config" JSONB,
    "workout_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_cards_user_id_created_at_idx" ON "shared_cards"("user_id", "created_at" DESC);
