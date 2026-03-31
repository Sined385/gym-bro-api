-- Add missing columns to onboarding_data
ALTER TABLE public.onboarding_data
    ADD COLUMN IF NOT EXISTS preferred_rest_time INTEGER,
    ADD COLUMN IF NOT EXISTS height_cm DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS biological_sex TEXT;

-- Add suggested_weight to session_exercises
ALTER TABLE public.session_exercises
    ADD COLUMN IF NOT EXISTS suggested_weight DOUBLE PRECISION;

-- Coach conversations
CREATE TABLE IF NOT EXISTS public.coach_conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own coach conversations"
    ON public.coach_conversations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coach conversations"
    ON public.coach_conversations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own coach conversations"
    ON public.coach_conversations FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own coach conversations"
    ON public.coach_conversations FOR DELETE
    USING (auth.uid() = user_id);

-- Coach messages
CREATE TABLE IF NOT EXISTS public.coach_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.coach_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    session_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own coach messages"
    ON public.coach_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.coach_conversations cc
            WHERE cc.id = conversation_id AND cc.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own coach messages"
    ON public.coach_messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.coach_conversations cc
            WHERE cc.id = conversation_id AND cc.user_id = auth.uid()
        )
    );

-- Training plans
CREATE TABLE IF NOT EXISTS public.training_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    week_number     INTEGER NOT NULL DEFAULT 1,
    week_start_date TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.training_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own training plans"
    ON public.training_plans FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own training plans"
    ON public.training_plans FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own training plans"
    ON public.training_plans FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own training plans"
    ON public.training_plans FOR DELETE
    USING (auth.uid() = user_id);

-- Plan days
CREATE TABLE IF NOT EXISTS public.plan_days (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id            UUID NOT NULL REFERENCES public.training_plans(id) ON DELETE CASCADE,
    day_of_week        INTEGER NOT NULL,
    day_type           TEXT NOT NULL,
    session_title      TEXT,
    session_type       TEXT,
    muscle_groups      TEXT[] NOT NULL DEFAULT '{}',
    exercises_json     JSONB NOT NULL DEFAULT '[]',
    status             TEXT NOT NULL DEFAULT 'pending',
    workout_session_id UUID UNIQUE REFERENCES public.workout_sessions(id),
    ai_notes           TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own plan days"
    ON public.plan_days FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.training_plans tp
            WHERE tp.id = plan_id AND tp.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own plan days"
    ON public.plan_days FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.training_plans tp
            WHERE tp.id = plan_id AND tp.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own plan days"
    ON public.plan_days FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.training_plans tp
            WHERE tp.id = plan_id AND tp.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own plan days"
    ON public.plan_days FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.training_plans tp
            WHERE tp.id = plan_id AND tp.user_id = auth.uid()
        )
    );
