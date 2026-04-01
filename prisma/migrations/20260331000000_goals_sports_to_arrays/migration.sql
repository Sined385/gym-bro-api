-- Convert primary_goal (String) to primary_goals (String[])
ALTER TABLE "onboarding_data"
  ADD COLUMN "primary_goals" TEXT[] DEFAULT '{}';

UPDATE "onboarding_data"
  SET "primary_goals" = ARRAY["primary_goal"]
  WHERE "primary_goal" IS NOT NULL AND "primary_goal" != '';

ALTER TABLE "onboarding_data"
  DROP COLUMN "primary_goal";

-- Convert primary_sport (String) to primary_sports (String[])
ALTER TABLE "onboarding_data"
  ADD COLUMN "primary_sports" TEXT[] DEFAULT '{}';

UPDATE "onboarding_data"
  SET "primary_sports" = ARRAY["primary_sport"]
  WHERE "primary_sport" IS NOT NULL AND "primary_sport" != '';

ALTER TABLE "onboarding_data"
  DROP COLUMN "primary_sport";
