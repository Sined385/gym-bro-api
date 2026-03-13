CREATE TABLE public.onboarding_data (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    primary_goal        VARCHAR(30) NOT NULL,
    primary_sport       TEXT NOT NULL,
    experience_level    VARCHAR(20) NOT NULL,
    training_frequency  INTEGER NOT NULL CHECK (training_frequency BETWEEN 1 AND 7),
    workout_duration    INTEGER NOT NULL CHECK (workout_duration IN (30, 45, 60, 90)),
    available_equipment VARCHAR(20) NOT NULL,
    injuries            JSONB DEFAULT '[]',
    completed_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX idx_onboarding_data_user_id ON public.onboarding_data(user_id);

-- Row Level Security
ALTER TABLE public.onboarding_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own onboarding data"
    ON public.onboarding_data FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding data"
    ON public.onboarding_data FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding data"
    ON public.onboarding_data FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own onboarding data"
    ON public.onboarding_data FOR DELETE
    USING (auth.uid() = user_id);
