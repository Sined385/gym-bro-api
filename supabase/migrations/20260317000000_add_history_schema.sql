-- ============================================================
-- exercise_sets
-- ============================================================

CREATE TABLE public.exercise_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID REFERENCES public.session_exercises(id) ON DELETE CASCADE NOT NULL,
    set_number INTEGER NOT NULL,
    weight DECIMAL,                          -- null for bodyweight exercises (e.g. Pull-ups)
    weight_unit TEXT NOT NULL DEFAULT 'lbs',  -- 'lbs' or 'kg'
    reps INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.exercise_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own exercise sets"
    ON public.exercise_sets FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.session_exercises se
            JOIN public.workout_sessions ws ON ws.id = se.session_id
            WHERE se.id = exercise_sets.exercise_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own exercise sets"
    ON public.exercise_sets FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.session_exercises se
            JOIN public.workout_sessions ws ON ws.id = se.session_id
            WHERE se.id = exercise_sets.exercise_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE INDEX idx_exercise_sets_exercise ON public.exercise_sets(exercise_id);

-- ============================================================
-- Alter session_exercises: add muscle_group
-- ============================================================

ALTER TABLE public.session_exercises
    ADD COLUMN muscle_group TEXT;

-- ============================================================
-- Alter workout_sessions: add calories and performance_score
-- ============================================================

ALTER TABLE public.workout_sessions
    ADD COLUMN calories INTEGER,
    ADD COLUMN performance_score INTEGER;
