-- AlterTable
ALTER TABLE "workout_templates" ADD COLUMN "share_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workout_templates_share_code_key" ON "workout_templates"("share_code");

-- CreateIndex
CREATE INDEX "workout_templates_share_code_idx" ON "workout_templates"("share_code");
