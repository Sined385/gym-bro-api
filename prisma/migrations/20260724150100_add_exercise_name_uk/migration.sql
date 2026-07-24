-- Ukrainian display name for system exercises. Seeded from
-- data/exercise-names.uk.json; NULL means "no translation, show the
-- English name".
ALTER TABLE exercise_library ADD COLUMN name_uk TEXT;
