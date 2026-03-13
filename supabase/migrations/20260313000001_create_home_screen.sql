-- Add full_name column to existing User table
ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS full_name TEXT;

-- ============================================================
-- workout_sessions
-- ============================================================

CREATE TABLE public.workout_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title            TEXT NOT NULL,
    type             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'proposed',
    started_at       TIMESTAMP WITH TIME ZONE,
    completed_at     TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    ai_generated     BOOLEAN DEFAULT FALSE,
    ai_message       TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sessions"
    ON public.workout_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
    ON public.workout_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
    ON public.workout_sessions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE INDEX idx_workout_sessions_user_id    ON public.workout_sessions(user_id);
CREATE INDEX idx_workout_sessions_status     ON public.workout_sessions(user_id, status);
CREATE INDEX idx_workout_sessions_completed  ON public.workout_sessions(user_id, completed_at);

-- ============================================================
-- session_exercises
-- ============================================================

CREATE TABLE public.session_exercises (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE NOT NULL,
    name             TEXT NOT NULL,
    step_number      INTEGER NOT NULL,
    sets_display     TEXT NOT NULL,
    sets             INTEGER,
    reps             INTEGER,
    duration_seconds INTEGER,
    is_per_side      BOOLEAN DEFAULT FALSE,
    accent_color     TEXT NOT NULL DEFAULT '#E86A75',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.session_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own exercises"
    ON public.session_exercises FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_exercises.session_id
              AND ws.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own exercises"
    ON public.session_exercises FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_sessions ws
            WHERE ws.id = session_exercises.session_id
              AND ws.user_id = auth.uid()
        )
    );

CREATE INDEX idx_session_exercises_session ON public.session_exercises(session_id);

-- ============================================================
-- motivation_insights
-- ============================================================

CREATE TABLE public.motivation_insights (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title              TEXT NOT NULL,
    message            TEXT NOT NULL,
    workouts_this_week INTEGER DEFAULT 0,
    personal_records   TEXT[],
    valid_from         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until        TIMESTAMP WITH TIME ZONE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.motivation_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own insights"
    ON public.motivation_insights FOR SELECT
    USING (auth.uid() = user_id);

CREATE INDEX idx_motivation_user ON public.motivation_insights(user_id, valid_until);

-- ============================================================
-- get_home_dashboard() RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_home_dashboard()
RETURNS JSON AS $$
DECLARE
    result       JSON;
    v_user_id    UUID := auth.uid();
    v_week_start TIMESTAMP WITH TIME ZONE;
    v_week_end   TIMESTAMP WITH TIME ZONE;
BEGIN
    v_week_start := date_trunc('week', NOW());
    v_week_end   := v_week_start + INTERVAL '7 days';

    SELECT json_build_object(
        'user', (
            SELECT json_build_object(
                'name',       COALESCE(up.full_name, split_part(up.email, '@', 1)),
                'avatar_url', up.avatar_url
            )
            FROM public."User" up
            WHERE up.id = v_user_id::TEXT
        ),
        'motivation', (
            SELECT json_build_object(
                'title',              mi.title,
                'message',            mi.message,
                'workouts_this_week', mi.workouts_this_week,
                'personal_records',   mi.personal_records
            )
            FROM public.motivation_insights mi
            WHERE mi.user_id = v_user_id
              AND (mi.valid_until IS NULL OR mi.valid_until > NOW())
            ORDER BY mi.created_at DESC
            LIMIT 1
        ),
        'week_completed_days', (
            SELECT COALESCE(json_agg(DISTINCT EXTRACT(DOW FROM ws.completed_at)::int), '[]'::json)
            FROM public.workout_sessions ws
            WHERE ws.user_id = v_user_id
              AND ws.status = 'completed'
              AND ws.completed_at >= v_week_start
              AND ws.completed_at <  v_week_end
        ),
        'proposed_session', (
            SELECT json_build_object(
                'id',               ws.id,
                'title',            ws.title,
                'type',             ws.type,
                'duration_minutes', ws.duration_minutes,
                'ai_message',       ws.ai_message,
                'exercises', (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'id',           se.id,
                            'name',         se.name,
                            'step_number',  se.step_number,
                            'sets_display', se.sets_display,
                            'accent_color', se.accent_color
                        ) ORDER BY se.step_number
                    ), '[]'::json)
                    FROM public.session_exercises se
                    WHERE se.session_id = ws.id
                )
            )
            FROM public.workout_sessions ws
            WHERE ws.user_id = v_user_id
              AND ws.status = 'proposed'
            ORDER BY ws.created_at DESC
            LIMIT 1
        )
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
