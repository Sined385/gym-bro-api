# Home Screen API Documentation

Backend API specification for the GymBro home screen. All endpoints require Supabase auth (JWT Bearer token). Data is scoped to the authenticated user via RLS.

---

## Database Schema

### `workout_sessions` table

```sql
CREATE TABLE public.workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,                         -- 'strength', 'cardio', 'recovery', 'mobility', 'custom'
    status TEXT NOT NULL DEFAULT 'proposed',     -- 'proposed', 'active', 'completed', 'skipped'
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,                   -- planned or actual duration
    ai_generated BOOLEAN DEFAULT FALSE,
    ai_message TEXT,                            -- AI reasoning for the session
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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

CREATE INDEX idx_workout_sessions_user_id ON public.workout_sessions(user_id);
CREATE INDEX idx_workout_sessions_status ON public.workout_sessions(user_id, status);
CREATE INDEX idx_workout_sessions_completed ON public.workout_sessions(user_id, completed_at);
```

### `session_exercises` table

```sql
CREATE TABLE public.session_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    step_number INTEGER NOT NULL,               -- ordering (1-based)
    sets_display TEXT NOT NULL,                  -- human-readable: "2 × 10", "2 × 30s/side"
    sets INTEGER,                               -- number of sets
    reps INTEGER,                               -- reps per set (nullable for time-based)
    duration_seconds INTEGER,                   -- for time-based exercises (nullable for rep-based)
    is_per_side BOOLEAN DEFAULT FALSE,
    accent_color TEXT NOT NULL DEFAULT '#E86A75', -- hex color for UI accent bar
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
```

### `motivation_insights` table

```sql
CREATE TABLE public.motivation_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,                        -- "Great momentum! 🔥"
    message TEXT NOT NULL,                      -- full message with markdown-style **bold**
    workouts_this_week INTEGER DEFAULT 0,
    personal_records TEXT[],                    -- ["squats", "deadlift"]
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,      -- auto-expire (end of week)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.motivation_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own insights"
    ON public.motivation_insights FOR SELECT
    USING (auth.uid() = user_id);

CREATE INDEX idx_motivation_user ON public.motivation_insights(user_id, valid_until);
```

---

## API Endpoints

All queries use the Supabase Swift client (`SupabaseConfig.client`).

---

### 1. GET Home Dashboard

**Purpose:** Fetch all data for the home screen in one call.

**Supabase RPC:**

```sql
CREATE OR REPLACE FUNCTION public.get_home_dashboard()
RETURNS JSON AS $$
DECLARE
    result JSON;
    v_user_id UUID := auth.uid();
    v_week_start TIMESTAMP WITH TIME ZONE;
    v_week_end TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Current week bounds (Monday-Sunday)
    v_week_start := date_trunc('week', NOW());
    v_week_end := v_week_start + INTERVAL '7 days';

    SELECT json_build_object(
        'user', (
            SELECT json_build_object(
                'name', COALESCE(up.full_name, split_part(up.email, '@', 1)),
                'avatar_url', up.avatar_url
            )
            FROM public.user_profiles up
            WHERE up.id = v_user_id
        ),
        'motivation', (
            SELECT json_build_object(
                'title', mi.title,
                'message', mi.message,
                'workouts_this_week', mi.workouts_this_week,
                'personal_records', mi.personal_records
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
              AND ws.completed_at < v_week_end
        ),
        'proposed_session', (
            SELECT json_build_object(
                'id', ws.id,
                'title', ws.title,
                'type', ws.type,
                'duration_minutes', ws.duration_minutes,
                'ai_message', ws.ai_message,
                'exercises', (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'id', se.id,
                            'name', se.name,
                            'step_number', se.step_number,
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
```

**Swift Client Call:**

```swift
struct HomeDashboardResponse: Codable {
    let user: UserSummary
    let motivation: MotivationInsight?
    let weekCompletedDays: [Int]       // ISO day-of-week (1=Mon, 7=Sun)
    let proposedSession: ProposedSession?

    enum CodingKeys: String, CodingKey {
        case user
        case motivation
        case weekCompletedDays = "week_completed_days"
        case proposedSession = "proposed_session"
    }
}

struct UserSummary: Codable {
    let name: String
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case name
        case avatarUrl = "avatar_url"
    }
}

struct MotivationInsight: Codable {
    let title: String
    let message: String
    let workoutsThisWeek: Int
    let personalRecords: [String]?

    enum CodingKeys: String, CodingKey {
        case title, message
        case workoutsThisWeek = "workouts_this_week"
        case personalRecords = "personal_records"
    }
}

struct ProposedSession: Codable, Identifiable {
    let id: String
    let title: String
    let type: String
    let durationMinutes: Int
    let aiMessage: String?
    let exercises: [SessionExercise]

    enum CodingKeys: String, CodingKey {
        case id, title, type, exercises
        case durationMinutes = "duration_minutes"
        case aiMessage = "ai_message"
    }
}

struct SessionExercise: Codable, Identifiable {
    let id: String
    let name: String
    let stepNumber: Int
    let setsDisplay: String
    let accentColor: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case stepNumber = "step_number"
        case setsDisplay = "sets_display"
        case accentColor = "accent_color"
    }
}

// Usage:
let response: HomeDashboardResponse = try await SupabaseConfig.client
    .rpc("get_home_dashboard")
    .execute()
    .value
```

**Example Response:**

```json
{
  "user": {
    "name": "Denys",
    "avatar_url": null
  },
  "motivation": {
    "title": "Great momentum! 🔥",
    "message": "You've crushed **4 workouts** this week and hit a new PR on squats. Keep building that consistency!",
    "workouts_this_week": 4,
    "personal_records": ["squats"]
  },
  "week_completed_days": [1, 2, 4, 5],
  "proposed_session": {
    "id": "a1b2c3d4-...",
    "title": "Active Recovery",
    "type": "recovery",
    "duration_minutes": 25,
    "ai_message": "Since you don't have a plan today, I generated a light mobility session to keep you active without overtaxing your muscles.",
    "exercises": [
      {
        "id": "e1f2...",
        "name": "Cat-Cow Stretches",
        "step_number": 1,
        "sets_display": "2 × 10",
        "accent_color": "#E86A75"
      },
      {
        "id": "e3f4...",
        "name": "Thoracic Rotations",
        "step_number": 2,
        "sets_display": "2 × 8/side",
        "accent_color": "#30C08D"
      },
      {
        "id": "e5f6...",
        "name": "Hip Flexor Stretch",
        "step_number": 3,
        "sets_display": "2 × 30s/side",
        "accent_color": "#7A82F6"
      },
      {
        "id": "e7f8...",
        "name": "90/90 Stretches",
        "step_number": 4,
        "sets_display": "2 × 10/side",
        "accent_color": "#F5A623"
      }
    ]
  }
}
```

---

### 2. POST Start Session

**Purpose:** Mark a proposed session as active, or create a new ad-hoc session.

**Supabase Query:**

```swift
// Start a proposed session
try await SupabaseConfig.client
    .from("workout_sessions")
    .update([
        "status": "active",
        "started_at": ISO8601DateFormatter().string(from: Date())
    ])
    .eq("id", value: sessionId)
    .eq("user_id", value: userId)
    .execute()
```

**Request Body (ad-hoc):**

```json
{
  "user_id": "uuid",
  "title": "Quick Workout",
  "type": "custom",
  "status": "active",
  "started_at": "2026-03-13T10:00:00Z",
  "duration_minutes": null,
  "ai_generated": false
}
```

---

### 3. POST Complete Session

**Purpose:** Mark an active session as completed.

```swift
try await SupabaseConfig.client
    .from("workout_sessions")
    .update([
        "status": "completed",
        "completed_at": ISO8601DateFormatter().string(from: Date()),
        "duration_minutes": actualDuration
    ])
    .eq("id", value: sessionId)
    .eq("user_id", value: userId)
    .execute()
```

---

### 4. GET Week Calendar

**Purpose:** Lightweight fetch of which days this week have completed workouts.

**Supabase Query:**

```swift
struct CompletedDay: Codable {
    let completedAt: Date

    enum CodingKeys: String, CodingKey {
        case completedAt = "completed_at"
    }
}

let completedSessions: [CompletedDay] = try await SupabaseConfig.client
    .from("workout_sessions")
    .select("completed_at")
    .eq("user_id", value: userId)
    .eq("status", value: "completed")
    .gte("completed_at", value: weekStartISO)
    .lt("completed_at", value: weekEndISO)
    .execute()
    .value
```

---

## Data Flow: Home Screen → API Mapping

| UI Component | Data Field | Source |
|---|---|---|
| Header greeting | User name | `user_profiles.full_name` |
| Header avatar | Profile image URL | `user_profiles.avatar_url` |
| Header greeting text | Time of day | Client-side (Calendar API) |
| MotivationCard title | Insight title | `motivation_insights.title` |
| MotivationCard message | Insight message | `motivation_insights.message` |
| MotivationCard bold text | Workout count | `motivation_insights.workouts_this_week` |
| WeekCalendar days | Day letters/numbers | Client-side (Calendar API) |
| WeekCalendar checkmarks | Completed days | `workout_sessions` WHERE status='completed' |
| ProposedSession title | Session name | `workout_sessions.title` |
| ProposedSession duration | Minutes | `workout_sessions.duration_minutes` |
| ProposedSession exercise count | Derived | `COUNT(session_exercises)` |
| ProposedSession AI quote | AI reasoning | `workout_sessions.ai_message` |
| Exercise name | Exercise name | `session_exercises.name` |
| Exercise step | Order number | `session_exercises.step_number` |
| Exercise sets badge | Display string | `session_exercises.sets_display` |
| Exercise accent bar | Color hex | `session_exercises.accent_color` |
| Start button | Session ID | `workout_sessions.id` |

---

## Accent Color Palette

Cycle through these colors for exercise accent bars:

| Step | Color | Hex |
|---|---|---|
| 1 | Red (primary) | `#E86A75` |
| 2 | Green | `#30C08D` |
| 3 | Purple | `#7A82F6` |
| 4 | Orange | `#F5A623` |
| 5+ | Repeat from 1 | — |

---

## Error States

| Scenario | Behavior |
|---|---|
| No auth token | Redirect to authentication |
| No user profile | Show onboarding |
| No motivation insight | Hide MotivationCard |
| No proposed session | Show "No session planned" empty state |
| No completed days this week | All calendar days show numbers only |
| Network failure | Show cached data + retry banner |
