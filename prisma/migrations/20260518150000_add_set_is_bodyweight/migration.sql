-- AlterTable: add is_bodyweight to exercise_sets
ALTER TABLE "exercise_sets" ADD COLUMN "is_bodyweight" BOOLEAN NOT NULL DEFAULT false;
