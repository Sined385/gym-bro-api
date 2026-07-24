-- Promo codes: admin-created codes granting temporary premium.
-- Multi-use (many users), once per user per code — enforced by the
-- unique (promo_code_id, user_id) constraint (race-safe).

CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

CREATE TABLE "promo_redemptions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "promo_code_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_redemptions_promo_code_id_user_id_key"
    ON "promo_redemptions"("promo_code_id", "user_id");
CREATE INDEX "promo_redemptions_user_id_idx" ON "promo_redemptions"("user_id");
CREATE INDEX "promo_redemptions_created_at_idx" ON "promo_redemptions"("created_at");

ALTER TABLE "promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey"
    FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
