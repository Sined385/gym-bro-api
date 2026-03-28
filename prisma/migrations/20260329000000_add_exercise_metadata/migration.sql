-- AlterTable
ALTER TABLE "exercise_library" ADD COLUMN "external_id" TEXT;
ALTER TABLE "exercise_library" ADD COLUMN "level" TEXT;
ALTER TABLE "exercise_library" ADD COLUMN "category" TEXT;
ALTER TABLE "exercise_library" ADD COLUMN "force" TEXT;
ALTER TABLE "exercise_library" ADD COLUMN "mechanic" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "exercise_library_external_id_key" ON "exercise_library"("external_id");
