-- Target pace for cardio (km/h), prescribed by the coach/plan or set by
-- the user. Guidance only — never overwritten with an actual value
-- (actual speed is derived from distance / duration). Null for strength.
ALTER TABLE "exercise_sets" ADD COLUMN "target_speed_kmh" DOUBLE PRECISION;
