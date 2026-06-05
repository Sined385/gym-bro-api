-- Backfill session_exercise.library_exercise_id for rows whose FK was
-- nulled by past destructive re-seeds of the exercise_library table.
-- The seed script used to DELETE all system exercises and INSERT new
-- ones with fresh UUIDs; to avoid violating the FK constraint it set
-- session_exercises.library_exercise_id = NULL on every historical
-- row that pointed at a system exercise. session_exercises.external_id
-- was preserved (sourced from the upstream catalog's stable id) and is
-- the bridge back to the current row.
--
-- Idempotent: re-running this migration on a DB where every nulled FK
-- has already been restored is a no-op (the WHERE clause finds nothing).
-- Going forward the seed script is idempotent (UPSERT by external_id)
-- so no new nulls will appear.

UPDATE session_exercises se
SET library_exercise_id = el.id
FROM exercise_library el
WHERE se.library_exercise_id IS NULL
  AND se.external_id IS NOT NULL
  AND el.external_id = se.external_id
  AND el.is_system = true;
