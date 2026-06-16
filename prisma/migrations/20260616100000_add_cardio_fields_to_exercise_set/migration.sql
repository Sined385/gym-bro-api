-- Cardio sets store work as duration (and optionally distance) instead
-- of weight × reps. Both null for strength sets.
ALTER TABLE "exercise_sets" ADD COLUMN "duration_seconds" INTEGER;
ALTER TABLE "exercise_sets" ADD COLUMN "distance_meters" INTEGER;
