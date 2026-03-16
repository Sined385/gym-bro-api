# Session History API Specification

Backend API spec for viewing completed workout session history. Extends the existing home screen API.

---

## Database Schema Changes

### New `exercise_sets` table

```sql
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
```

### Alter `session_exercises` table

```sql
ALTER TABLE public.session_exercises
    ADD COLUMN muscle_group TEXT;  -- 'Chest', 'Back', 'Shoulders', etc.
```

### Alter `workout_sessions` table

```sql
ALTER TABLE public.workout_sessions
    ADD COLUMN calories INTEGER,            -- total calories burned
    ADD COLUMN performance_score INTEGER;   -- score out of 100
```

### Prisma Schema Additions

```prisma
model ExerciseSet {
  id            String          @id @default(uuid())
  exercise_id   String
  set_number    Int
  weight        Decimal?
  weight_unit   String          @default("lbs")
  reps          Int
  created_at    DateTime        @default(now())
  exercise      SessionExercise @relation(fields: [exercise_id], references: [id], onDelete: Cascade)

  @@map("exercise_sets")
}
```

Update `SessionExercise` model:
- Add `muscle_group String?`
- Add `exercise_sets ExerciseSet[]` relation

Update `WorkoutSession` model:
- Add `calories Int?`
- Add `performance_score Int?`

---

## API Endpoint

### `GET /api/v1/home/history?date=YYYY-MM-DD`

Fetch the completed session for a given date.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| date  | string (YYYY-MM-DD) | Yes | The date to fetch history for |

**Response (200) — session found:**
```json
{
  "date": "2026-03-11",
  "session": {
    "id": "uuid",
    "title": "Mon's Session",
    "type": "strength",
    "status": "completed",
    "duration_minutes": 52,
    "calories": 385,
    "performance_score": 87,
    "started_at": "2026-03-11T08:00:00Z",
    "completed_at": "2026-03-11T08:52:00Z",
    "exercises": [
      {
        "id": "uuid",
        "name": "Barbell Bench Press",
        "muscle_group": "Chest",
        "accent_color": "#E86A75",
        "step_number": 1,
        "sets": [
          { "set_number": 1, "weight": 185, "weight_unit": "lbs", "reps": 8 },
          { "set_number": 2, "weight": 185, "weight_unit": "lbs", "reps": 8 },
          { "set_number": 3, "weight": 185, "weight_unit": "lbs", "reps": 7 },
          { "set_number": 4, "weight": 185, "weight_unit": "lbs", "reps": 6 }
        ]
      },
      {
        "id": "uuid",
        "name": "Pull-ups",
        "muscle_group": "Back",
        "accent_color": "#7A82F6",
        "step_number": 3,
        "sets": [
          { "set_number": 1, "weight": null, "weight_unit": "lbs", "reps": 12 },
          { "set_number": 2, "weight": null, "weight_unit": "lbs", "reps": 10 }
        ]
      }
    ]
  }
}
```

**Response (200) — no session:**
```json
{
  "date": "2026-03-11",
  "session": null
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Parse `date` query param, compute start/end of that day in user's timezone
2. Query `WorkoutSession` where `user_id = req.user.id`, `status = 'completed'`, `completed_at` within that day
3. Include `exercises` → `exercise_sets` (ordered by `step_number`, `set_number`)
4. Return formatted response

**Controller** (`src/home/home.controller.ts`):
```typescript
@Get('history')
@UseGuards(AuthGuard)
async getSessionHistory(
  @Query('date') date: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.getSessionHistory(req.user.id, date);
}
```

---

## Completed Days Calendar Endpoint

### `GET /api/v1/home/completed-days?month=YYYY-MM`

Returns all dates in a given month that have completed sessions (for the expanded calendar view).

**Response (200):**
```json
{
  "month": "2026-01",
  "completed_dates": ["2026-01-22", "2026-01-23", "2026-01-24", "2026-01-25", "2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31"]
}
```

---

## Accent Color Palette

Cycle through these for exercise accent bars:

| Step | Color | Hex |
|------|-------|-----|
| 1 | Red (primary) | `#E86A75` |
| 2 | Green | `#30C08D` |
| 3 | Purple | `#7A82F6` |
| 4 | Orange | `#F5A623` |
| 5+ | Repeat from 1 | — |
