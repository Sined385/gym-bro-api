-- AlterTable
ALTER TABLE "User" ADD COLUMN "is_premium" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "premium_source" TEXT;
ALTER TABLE "User" ADD COLUMN "premium_granted_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "premium_expires_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "storekit_transaction_id" TEXT;
ALTER TABLE "User" ADD COLUMN "storekit_product_id" TEXT;
