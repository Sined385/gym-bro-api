-- AlterTable: add external_id column to session_exercises
ALTER TABLE "session_exercises" ADD COLUMN "external_id" TEXT;

-- Backfill session_exercises: resolve by library_exercise_id FK, then by name
UPDATE "session_exercises" se
SET "external_id" = el."external_id"
FROM "exercise_library" el
WHERE se."library_exercise_id" = el."id"
  AND el."external_id" IS NOT NULL
  AND se."external_id" IS NULL;

UPDATE "session_exercises" se
SET "external_id" = el."external_id"
FROM "exercise_library" el
WHERE el."name" = se."name"
  AND el."is_system" = true
  AND el."external_id" IS NOT NULL
  AND se."external_id" IS NULL;

-- Backfill plan_days.exercises_json: add external_id to each exercise element
UPDATE "plan_days" pd
SET "exercises_json" = (
  SELECT jsonb_agg(
    CASE
      WHEN el_id."external_id" IS NOT NULL THEN
        elem || jsonb_build_object('external_id', el_id."external_id")
      WHEN el_name."external_id" IS NOT NULL THEN
        elem || jsonb_build_object('external_id', el_name."external_id")
      ELSE
        elem || jsonb_build_object('external_id', null)
    END
  )
  FROM jsonb_array_elements(pd."exercises_json"::jsonb) AS elem
  LEFT JOIN "exercise_library" el_id
    ON (elem ->> 'library_exercise_id') IS NOT NULL
    AND (elem ->> 'library_exercise_id') <> ''
    AND el_id."id" = (elem ->> 'library_exercise_id')::uuid
    AND el_id."external_id" IS NOT NULL
  LEFT JOIN "exercise_library" el_name
    ON el_name."name" = (elem ->> 'name')
    AND el_name."is_system" = true
    AND el_name."external_id" IS NOT NULL
)
WHERE jsonb_array_length(pd."exercises_json"::jsonb) > 0;

-- Backfill workout_templates.exercises_json: add external_id to each exercise element
UPDATE "workout_templates" wt
SET "exercises_json" = (
  SELECT jsonb_agg(
    CASE
      WHEN el_id."external_id" IS NOT NULL THEN
        elem || jsonb_build_object('external_id', el_id."external_id")
      WHEN el_name."external_id" IS NOT NULL THEN
        elem || jsonb_build_object('external_id', el_name."external_id")
      ELSE
        elem || jsonb_build_object('external_id', null)
    END
  )
  FROM jsonb_array_elements(wt."exercises_json"::jsonb) AS elem
  LEFT JOIN "exercise_library" el_id
    ON (elem ->> 'library_exercise_id') IS NOT NULL
    AND (elem ->> 'library_exercise_id') <> ''
    AND el_id."id" = (elem ->> 'library_exercise_id')::uuid
    AND el_id."external_id" IS NOT NULL
  LEFT JOIN "exercise_library" el_name
    ON el_name."name" = (elem ->> 'name')
    AND el_name."is_system" = true
    AND el_name."external_id" IS NOT NULL
)
WHERE jsonb_array_length(wt."exercises_json"::jsonb) > 0;
