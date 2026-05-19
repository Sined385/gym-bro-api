-- AlterTable: persist the user's share-card composition + a rasterized preview URL
ALTER TABLE "posts" ADD COLUMN "share_config" JSONB;
ALTER TABLE "posts" ADD COLUMN "card_image_url" TEXT;
