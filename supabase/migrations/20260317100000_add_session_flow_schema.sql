-- ============================================================
-- exercise_library
-- ============================================================

CREATE TABLE public.exercise_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    equipment TEXT NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.exercise_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read system exercises and their own"
    ON public.exercise_library FOR SELECT
    USING (
        is_system = true OR user_id = auth.uid()
    );

CREATE POLICY "Users can insert their own custom exercises"
    ON public.exercise_library FOR INSERT
    WITH CHECK (
        user_id = auth.uid() AND is_system = false
    );

CREATE INDEX idx_exercise_library_user ON public.exercise_library(user_id);
CREATE INDEX idx_exercise_library_muscle_group ON public.exercise_library(muscle_group);

-- Seed system exercises
INSERT INTO public.exercise_library (user_id, name, muscle_group, equipment, is_system) VALUES
    (NULL, 'Barbell Bench Press', 'Chest', 'Barbell', true),
    (NULL, 'Incline Dumbbell Press', 'Chest', 'Dumbbells', true),
    (NULL, 'Pull-ups', 'Back', 'Bodyweight', true),
    (NULL, 'Barbell Row', 'Back', 'Barbell', true),
    (NULL, 'Barbell Squat', 'Legs', 'Barbell', true),
    (NULL, 'Romanian Deadlift', 'Legs', 'Barbell', true),
    (NULL, 'Leg Press', 'Legs', 'Machine', true),
    (NULL, 'Overhead Press', 'Shoulders', 'Barbell', true),
    (NULL, 'Lateral Raise', 'Shoulders', 'Dumbbells', true),
    (NULL, 'Bicep Curl', 'Arms', 'Dumbbells', true),
    (NULL, 'Tricep Extension', 'Arms', 'Cable', true),
    (NULL, 'Plank', 'Core', 'Bodyweight', true);

-- ============================================================
-- session_feedback
-- ============================================================

CREATE TABLE public.session_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE UNIQUE NOT NULL,
    effort_level INTEGER NOT NULL CHECK (effort_level BETWEEN 1 AND 10),
    energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    pain_discomfort TEXT NOT NULL DEFAULT 'None',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session feedback"
    ON public.session_feedback FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_feedback.session_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own session feedback"
    ON public.session_feedback FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_feedback.session_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own session feedback"
    ON public.session_feedback FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_feedback.session_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE INDEX idx_session_feedback_session ON public.session_feedback(session_id);

-- ============================================================
-- Alter session_exercises: add equipment, library_exercise_id, superset columns
-- ============================================================

ALTER TABLE public.session_exercises
    ADD COLUMN equipment TEXT,
    ADD COLUMN library_exercise_id UUID REFERENCES public.exercise_library(id),
    ADD COLUMN superset_group_id UUID,
    ADD COLUMN superset_order TEXT;

-- ============================================================
-- Alter exercise_sets: add is_completed
-- ============================================================

ALTER TABLE public.exercise_sets
    ADD COLUMN is_completed BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- RLS policies for UPDATE/DELETE on session_exercises
-- ============================================================

CREATE POLICY "Users can update own session exercises"
    ON public.session_exercises FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_exercises.session_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own session exercises"
    ON public.session_exercises FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_exercises.session_id
            AND ws.user_id = auth.uid()
        )
    );

-- ============================================================
-- RLS policies for UPDATE/DELETE on exercise_sets
-- ============================================================

CREATE POLICY "Users can update own exercise sets"
    ON public.exercise_sets FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.session_exercises se
            JOIN public.workout_sessions ws ON ws.id = se.session_id
            WHERE se.id = exercise_sets.exercise_id
            AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own exercise sets"
    ON public.exercise_sets FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.session_exercises se
            JOIN public.workout_sessions ws ON ws.id = se.session_id
            WHERE se.id = exercise_sets.exercise_id
            AND ws.user_id = auth.uid()
        )
    );
