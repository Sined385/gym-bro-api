-- AlterTable: add emoji column with default
ALTER TABLE "post_likes" ADD COLUMN "emoji" TEXT NOT NULL DEFAULT 'heart';

-- Drop old unique constraint (not index)
ALTER TABLE "post_likes" DROP CONSTRAINT IF EXISTS "post_likes_post_id_user_id_key";

-- CreateIndex: new unique constraint including emoji
CREATE UNIQUE INDEX "post_likes_post_id_user_id_emoji_key" ON "post_likes"("post_id", "user_id", "emoji");

-- CreateIndex: index on post_id for fast reaction lookups
CREATE INDEX "post_likes_post_id_idx" ON "post_likes"("post_id");
