-- Plan-generation hardening.
--
-- 1) Deactivate duplicate active plans (keep the most recent per user)
--    so the partial unique index below can be created on existing data.
UPDATE "training_plans" tp
SET "is_active" = false
WHERE tp."is_active"
  AND EXISTS (
    SELECT 1
    FROM "training_plans" t2
    WHERE t2."user_id" = tp."user_id"
      AND t2."is_active"
      AND (
        t2."created_at" > tp."created_at"
        OR (t2."created_at" = tp."created_at" AND t2."id" > tp."id")
      )
  );

-- 2) At most one active plan per user. Concurrent generations racing
--    past the application-level check now fail on insert instead of
--    leaving two active plans. Also serves as the index for the hot
--    (user_id, is_active) lookups on every /plans and /home/dashboard.
--    (Partial index — not representable in schema.prisma; see the NOTE
--    on the TrainingPlan model.)
CREATE UNIQUE INDEX "training_plans_one_active_per_user"
  ON "training_plans"("user_id")
  WHERE "is_active";

-- CreateIndex
CREATE INDEX "training_plans_user_id_week_number_idx" ON "training_plans"("user_id", "week_number");

-- CreateIndex
CREATE INDEX "plan_days_plan_id_idx" ON "plan_days"("plan_id");
