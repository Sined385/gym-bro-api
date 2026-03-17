# Session Flow API Specification

Backend API spec for the in-workout session flow: exercise library, adding/removing exercises, logging sets, supersets, and post-workout feedback. Extends the existing home screen and history APIs.

---

## Database Schema Changes

### New `exercise_library` table

Pre-seeded catalog of common exercises plus user-created custom exercises.

```sql
CREATE TABLE public.exercise_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL for system exercises
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,       -- 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Other'
    equipment TEXT NOT NULL,          -- 'Barbell', 'Dumbbells', 'Cable', 'Machine', 'Bodyweight', 'Other'
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
```

**Pre-seeded system exercises** (inserted with `user_id = NULL`, `is_system = true`):

```sql
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
```

### New `session_feedback` table

Post-workout feedback captured after session completion, used as AI coaching context.

```sql
CREATE TABLE public.session_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE UNIQUE NOT NULL,
    effort_level INTEGER NOT NULL CHECK (effort_level BETWEEN 1 AND 10),
    energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    pain_discomfort TEXT NOT NULL DEFAULT 'None',  -- 'None', 'Joint Pain', 'Muscle Tweak', 'Extreme Fatigue'
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

CREATE INDEX idx_session_feedback_session ON public.session_feedback(session_id);
```

### Alter `session_exercises` table

```sql
ALTER TABLE public.session_exercises
    ADD COLUMN equipment TEXT,
    ADD COLUMN library_exercise_id UUID REFERENCES public.exercise_library(id),
    ADD COLUMN superset_group_id UUID,  -- NULL for standalone exercises
    ADD COLUMN superset_order TEXT;      -- 'A', 'B', 'C' within superset group
```

### Alter `workout_sessions` table

> **Note:** The `calories` and `performance_score` columns were already added by the History API spec (`HISTORY_API_SPEC.md`). No additional alterations needed here.

### Prisma Schema Additions

```prisma
model ExerciseLibrary {
  id              String            @id @default(uuid())
  user_id         String?
  name            String
  muscle_group    String
  equipment       String
  is_system       Boolean           @default(false)
  created_at      DateTime          @default(now())
  session_exercises SessionExercise[]

  @@map("exercise_library")
}

model SessionFeedback {
  id               String         @id @default(uuid())
  session_id       String         @unique
  effort_level     Int
  energy_level     Int
  pain_discomfort  String         @default("None")
  created_at       DateTime       @default(now())
  session          WorkoutSession @relation(fields: [session_id], references: [id], onDelete: Cascade)

  @@map("session_feedback")
}
```

Update `SessionExercise` model:
- Add `equipment String?`
- Add `library_exercise_id String?`
- Add `superset_group_id String?`
- Add `superset_order String?`
- Add `library_exercise ExerciseLibrary? @relation(fields: [library_exercise_id], references: [id])`

Update `WorkoutSession` model:
- Add `feedback SessionFeedback?` relation

---

## API Endpoints

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/api/v1/exercises` | List exercise library |
| 2 | POST | `/api/v1/exercises` | Create custom exercise |
| 3 | GET | `/api/v1/exercises/:id/previous-sets` | Previous sets for exercise |
| 4 | POST | `/api/v1/home/sessions/:id/exercises` | Add exercise(s) to session |
| 5 | POST | `/api/v1/home/sessions/:id/supersets` | Create superset |
| 6 | DELETE | `/api/v1/home/sessions/:id/exercises/:eid` | Remove exercise from session |
| 7 | POST | `/api/v1/home/sessions/:id/exercises/:eid/sets` | Log a set |
| 8 | PATCH | `/api/v1/home/sessions/:id/exercises/:eid/sets/:sid` | Update a set |
| 9 | DELETE | `/api/v1/home/sessions/:id/exercises/:eid/sets/:sid` | Delete a set |
| 10 | POST | `/api/v1/home/sessions/:id/feedback` | Submit post-workout feedback |
| 11 | PATCH | `/api/v1/home/sessions/:id/complete` | Complete session (modified) |

---

### 1. `GET /api/v1/exercises?search=&muscle_group=`

List exercise library — returns all system exercises plus the authenticated user's custom exercises. Supports optional filtering.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| search | string | No | Case-insensitive partial match on exercise name (ILIKE `%search%`) |
| muscle_group | string | No | Exact match filter: Chest, Back, Legs, Shoulders, Arms, Core, Other |

**Response (200):**
```json
{
  "exercises": [
    {
      "id": "uuid",
      "name": "Barbell Bench Press",
      "muscle_group": "Chest",
      "equipment": "Barbell",
      "is_system": true
    },
    {
      "id": "uuid",
      "name": "Incline Dumbbell Press",
      "muscle_group": "Chest",
      "equipment": "Dumbbells",
      "is_system": true
    },
    {
      "id": "uuid",
      "name": "My Custom Press",
      "muscle_group": "Chest",
      "equipment": "Machine",
      "is_system": false
    }
  ]
}
```

**Implementation notes** (`src/exercises/exercises.service.ts`):
1. Query `ExerciseLibrary` where `is_system = true` OR `user_id = req.user.id`
2. If `search` param provided, add `name ILIKE '%search%'` filter
3. If `muscle_group` param provided, add exact match filter
4. Order by `is_system DESC, name ASC` (system exercises first, then alphabetical)

**Controller** (`src/exercises/exercises.controller.ts`):
```typescript
@Get()
@UseGuards(AuthGuard)
async listExercises(
  @Query('search') search?: string,
  @Query('muscle_group') muscleGroup?: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.exercisesService.listExercises(req.user.id, search, muscleGroup);
}
```

---

### 2. `POST /api/v1/exercises`

Create a custom exercise in the user's personal library.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body:**
```json
{
  "name": "Cable Fly",
  "muscle_group": "Chest",
  "equipment": "Cable"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "name": "Cable Fly",
  "muscle_group": "Chest",
  "equipment": "Cable",
  "is_system": false
}
```

**Implementation notes** (`src/exercises/exercises.service.ts`):
1. Validate `muscle_group` is one of: Chest, Back, Legs, Shoulders, Arms, Core, Other
2. Validate `equipment` is one of: Barbell, Dumbbells, Cable, Machine, Bodyweight, Other
3. Insert into `ExerciseLibrary` with `user_id = req.user.id` and `is_system = false`
4. Return created exercise

**Controller** (`src/exercises/exercises.controller.ts`):
```typescript
@Post()
@UseGuards(AuthGuard)
async createExercise(
  @Body() dto: CreateExerciseDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.exercisesService.createExercise(req.user.id, dto);
}
```

---

### 3. `GET /api/v1/exercises/:id/previous-sets`

Fetch the user's last logged sets for a given library exercise. Finds the most recent completed session containing that `library_exercise_id` and returns its sets.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200) — previous sets found:**
```json
{
  "exercise_id": "uuid",
  "session_date": "2026-03-15T08:52:00Z",
  "sets": [
    { "set_number": 1, "weight": 185, "weight_unit": "lbs", "reps": 8 },
    { "set_number": 2, "weight": 185, "weight_unit": "lbs", "reps": 8 },
    { "set_number": 3, "weight": 185, "weight_unit": "lbs", "reps": 7 }
  ]
}
```

**Response (200) — no previous data:**
```json
{
  "exercise_id": "uuid",
  "session_date": null,
  "sets": []
}
```

**Implementation notes** (`src/exercises/exercises.service.ts`):
1. Find most recent `WorkoutSession` with `status = 'completed'` and `user_id = req.user.id` that contains a `SessionExercise` with `library_exercise_id = :id`
2. Order by `completed_at DESC`, take first
3. Return the `exercise_sets` for that session exercise, ordered by `set_number ASC`
4. If no matching session found, return empty sets array with `session_date: null`

**Controller** (`src/exercises/exercises.controller.ts`):
```typescript
@Get(':id/previous-sets')
@UseGuards(AuthGuard)
async getPreviousSets(
  @Param('id') exerciseId: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.exercisesService.getPreviousSets(req.user.id, exerciseId);
}
```

---

### 4. `POST /api/v1/home/sessions/:id/exercises`

Add one or more exercises to an active session.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body:**
```json
{
  "exercises": [
    {
      "library_exercise_id": "uuid",
      "name": "Barbell Bench Press",
      "muscle_group": "Chest",
      "equipment": "Barbell"
    },
    {
      "library_exercise_id": "uuid",
      "name": "Incline Dumbbell Press",
      "muscle_group": "Chest",
      "equipment": "Dumbbells"
    }
  ]
}
```

**Response (201):**
```json
{
  "exercises": [
    {
      "id": "uuid",
      "library_exercise_id": "uuid",
      "name": "Barbell Bench Press",
      "muscle_group": "Chest",
      "equipment": "Barbell",
      "step_number": 1,
      "accent_color": "#E86A75",
      "sets": []
    },
    {
      "id": "uuid",
      "library_exercise_id": "uuid",
      "name": "Incline Dumbbell Press",
      "muscle_group": "Chest",
      "equipment": "Dumbbells",
      "step_number": 2,
      "accent_color": "#30C08D",
      "sets": []
    }
  ]
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Get current max `step_number` for the session (default 0)
3. For each exercise in the array, create a `SessionExercise` with:
   - `session_id` = `:id`
   - `library_exercise_id`, `name`, `muscle_group`, `equipment` from body
   - `step_number` = max + 1, max + 2, etc.
   - `accent_color` assigned by cycling the color palette (see History spec)
4. Return all created exercises

**Controller** (`src/home/home.controller.ts`):
```typescript
@Post('sessions/:id/exercises')
@UseGuards(AuthGuard)
async addExercises(
  @Param('id') sessionId: string,
  @Body() dto: AddExercisesDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.addExercises(req.user.id, sessionId, dto);
}
```

---

### 5. `POST /api/v1/home/sessions/:id/supersets`

Group existing session exercises into a superset by assigning them a shared `superset_group_id`.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body:**
```json
{
  "exercise_ids": ["uuid-exercise-1", "uuid-exercise-2"]
}
```

**Response (200):**
```json
{
  "superset_group_id": "uuid-generated-group",
  "exercises": [
    {
      "id": "uuid-exercise-1",
      "name": "Bicep Curl",
      "superset_group_id": "uuid-generated-group",
      "superset_order": "A"
    },
    {
      "id": "uuid-exercise-2",
      "name": "Tricep Extension",
      "superset_group_id": "uuid-generated-group",
      "superset_order": "B"
    }
  ]
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Verify all `exercise_ids` belong to this session
3. Generate a new UUID for `superset_group_id`
4. Update each `SessionExercise` in order:
   - Set `superset_group_id` to the generated UUID
   - Set `superset_order` to 'A', 'B', 'C', etc. based on array position
5. Return updated exercises

**Controller** (`src/home/home.controller.ts`):
```typescript
@Post('sessions/:id/supersets')
@UseGuards(AuthGuard)
async createSuperset(
  @Param('id') sessionId: string,
  @Body() dto: CreateSupersetDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.createSuperset(req.user.id, sessionId, dto);
}
```

---

### 6. `DELETE /api/v1/home/sessions/:id/exercises/:eid`

Remove an exercise from a session. Cascades to delete all associated sets.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "deleted": true
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Verify exercise `:eid` belongs to session `:id`
3. Delete the `SessionExercise` row — `ON DELETE CASCADE` removes associated `exercise_sets`
4. If the deleted exercise was part of a superset and only one exercise remains in that superset group, clear `superset_group_id` and `superset_order` from the remaining exercise

**Controller** (`src/home/home.controller.ts`):
```typescript
@Delete('sessions/:id/exercises/:eid')
@UseGuards(AuthGuard)
async removeExercise(
  @Param('id') sessionId: string,
  @Param('eid') exerciseId: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.removeExercise(req.user.id, sessionId, exerciseId);
}
```

---

### 7. `POST /api/v1/home/sessions/:id/exercises/:eid/sets`

Log a completed set for an exercise.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body:**
```json
{
  "set_number": 1,
  "weight": 185,
  "weight_unit": "lbs",
  "reps": 8
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "exercise_id": "uuid",
  "set_number": 1,
  "weight": 185,
  "weight_unit": "lbs",
  "reps": 8,
  "is_completed": true,
  "created_at": "2026-03-17T08:15:00Z"
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Verify exercise `:eid` belongs to session `:id`
3. Insert into `ExerciseSet` with `exercise_id = :eid`, fields from body, and `is_completed = true`
4. `weight` can be `null` for bodyweight exercises
5. Return the created set

**Controller** (`src/home/home.controller.ts`):
```typescript
@Post('sessions/:id/exercises/:eid/sets')
@UseGuards(AuthGuard)
async logSet(
  @Param('id') sessionId: string,
  @Param('eid') exerciseId: string,
  @Body() dto: LogSetDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.logSet(req.user.id, sessionId, exerciseId, dto);
}
```

---

### 8. `PATCH /api/v1/home/sessions/:id/exercises/:eid/sets/:sid`

Update an existing set (e.g. correct weight, reps, or mark incomplete).

**Headers:**
```
Authorization: Bearer <token>
```

**Request body (partial):**
```json
{
  "weight": 190,
  "reps": 6,
  "is_completed": true
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "exercise_id": "uuid",
  "set_number": 1,
  "weight": 190,
  "weight_unit": "lbs",
  "reps": 6,
  "is_completed": true,
  "created_at": "2026-03-17T08:15:00Z"
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Verify exercise `:eid` belongs to session `:id`
3. Verify set `:sid` belongs to exercise `:eid`
4. Update only the provided fields (`weight`, `weight_unit`, `reps`, `is_completed`)
5. Return the updated set

**Controller** (`src/home/home.controller.ts`):
```typescript
@Patch('sessions/:id/exercises/:eid/sets/:sid')
@UseGuards(AuthGuard)
async updateSet(
  @Param('id') sessionId: string,
  @Param('eid') exerciseId: string,
  @Param('sid') setId: string,
  @Body() dto: UpdateSetDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.updateSet(req.user.id, sessionId, exerciseId, setId, dto);
}
```

---

### 9. `DELETE /api/v1/home/sessions/:id/exercises/:eid/sets/:sid`

Delete a set from an exercise.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "deleted": true
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists, belongs to user, and `status = 'active'`
2. Verify exercise `:eid` belongs to session `:id`
3. Verify set `:sid` belongs to exercise `:eid`
4. Delete the `ExerciseSet` row

**Controller** (`src/home/home.controller.ts`):
```typescript
@Delete('sessions/:id/exercises/:eid/sets/:sid')
@UseGuards(AuthGuard)
async deleteSet(
  @Param('id') sessionId: string,
  @Param('eid') exerciseId: string,
  @Param('sid') setId: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.deleteSet(req.user.id, sessionId, exerciseId, setId);
}
```

---

### 10. `POST /api/v1/home/sessions/:id/feedback`

Submit post-workout feedback for a session. Can be submitted independently of session completion.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body:**
```json
{
  "effort_level": 8,
  "energy_level": 3,
  "pain_discomfort": "None"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "session_id": "uuid",
  "effort_level": 8,
  "energy_level": 3,
  "pain_discomfort": "None",
  "created_at": "2026-03-17T09:05:00Z"
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Verify session exists and belongs to user
2. Validate `effort_level` is 1-10, `energy_level` is 1-5
3. Validate `pain_discomfort` is one of: None, Joint Pain, Muscle Tweak, Extreme Fatigue
4. Insert into `SessionFeedback` (upsert — if feedback already exists for this session, update it)
5. Return created/updated feedback

**Controller** (`src/home/home.controller.ts`):
```typescript
@Post('sessions/:id/feedback')
@UseGuards(AuthGuard)
async submitFeedback(
  @Param('id') sessionId: string,
  @Body() dto: SubmitFeedbackDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.submitFeedback(req.user.id, sessionId, dto);
}
```

---

### 11. `PATCH /api/v1/home/sessions/:id/complete`

Complete a session. Modified from the existing endpoint to accept optional inline feedback.

**Headers:**
```
Authorization: Bearer <token>
```

**Request body (optional feedback):**
```json
{
  "feedback": {
    "effort_level": 8,
    "energy_level": 3,
    "pain_discomfort": "None"
  }
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "title": "Tue's Session",
  "type": "strength",
  "status": "completed",
  "duration_minutes": 48,
  "calories": 370,
  "performance_score": 82,
  "started_at": "2026-03-17T08:00:00Z",
  "completed_at": "2026-03-17T08:48:00Z",
  "feedback": {
    "effort_level": 8,
    "energy_level": 3,
    "pain_discomfort": "None"
  }
}
```

**Implementation notes** (`src/home/home.service.ts`):
1. Existing completion logic: set `status = 'completed'`, `completed_at = NOW()`, compute `duration_minutes`, `calories`, `performance_score`
2. If `feedback` object is present in body, create/upsert `SessionFeedback` in the same transaction
3. Return session with feedback included

**Controller** (`src/home/home.controller.ts`):
```typescript
@Patch('sessions/:id/complete')
@UseGuards(AuthGuard)
async completeSession(
  @Param('id') sessionId: string,
  @Body() dto: CompleteSessionDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.homeService.completeSession(req.user.id, sessionId, dto);
}
```

---

## Superset Model

Exercises sharing the same `superset_group_id` are performed together as alternating rounds. Within a superset group, `superset_order` determines the execution sequence ('A', 'B', 'C').

**How it works:**
- A superset groups 2-3 exercises that the user alternates between
- `set_number` represents the **round number** across all exercises in the group
- Example: Bicep Curl (A) and Tricep Extension (B) in a superset — Round 1 means one set of curls then one set of extensions, Round 2 repeats

**Data example:**
```
superset_group_id: "abc-123"

Exercise: Bicep Curl       | superset_order: A | set_number 1: 25lbs x 12 | set_number 2: 25lbs x 10
Exercise: Tricep Extension | superset_order: B | set_number 1: 30lbs x 12 | set_number 2: 30lbs x 10
```

Standalone exercises have `superset_group_id = NULL` and `superset_order = NULL`.

---

## AI Context Shape

When session data is forwarded to the AI coaching module, it includes the full workout context in the following shape:

```json
{
  "session": {
    "id": "uuid",
    "title": "Tue's Session",
    "type": "strength",
    "status": "completed",
    "duration_minutes": 48,
    "started_at": "2026-03-17T08:00:00Z",
    "completed_at": "2026-03-17T08:48:00Z",
    "exercises": [
      {
        "name": "Barbell Bench Press",
        "muscle_group": "Chest",
        "equipment": "Barbell",
        "superset_group_id": null,
        "superset_order": null,
        "sets": [
          { "set_number": 1, "weight": 185, "weight_unit": "lbs", "reps": 8 },
          { "set_number": 2, "weight": 185, "weight_unit": "lbs", "reps": 8 },
          { "set_number": 3, "weight": 185, "weight_unit": "lbs", "reps": 7 }
        ]
      },
      {
        "name": "Bicep Curl",
        "muscle_group": "Arms",
        "equipment": "Dumbbells",
        "superset_group_id": "abc-123",
        "superset_order": "A",
        "sets": [
          { "set_number": 1, "weight": 25, "weight_unit": "lbs", "reps": 12 },
          { "set_number": 2, "weight": 25, "weight_unit": "lbs", "reps": 10 }
        ]
      },
      {
        "name": "Tricep Extension",
        "muscle_group": "Arms",
        "equipment": "Cable",
        "superset_group_id": "abc-123",
        "superset_order": "B",
        "sets": [
          { "set_number": 1, "weight": 30, "weight_unit": "lbs", "reps": 12 },
          { "set_number": 2, "weight": 30, "weight_unit": "lbs", "reps": 10 }
        ]
      }
    ],
    "feedback": {
      "effort_level": 8,
      "energy_level": 3,
      "pain_discomfort": "None"
    }
  }
}
```

The AI uses this context to:
- Track per-exercise volume and progression across sessions
- Understand superset groupings (exercises with matching `superset_group_id` are performed as alternating rounds)
- Factor in subjective feedback (`effort_level`, `energy_level`, `pain_discomfort`) when adjusting future programming

---

## Accent Color Palette

Same palette as the History spec — cycle through for exercise accent bars:

| Step | Color | Hex |
|------|-------|-----|
| 1 | Red (primary) | `#E86A75` |
| 2 | Green | `#30C08D` |
| 3 | Purple | `#7A82F6` |
| 4 | Orange | `#F5A623` |
| 5+ | Repeat from 1 | — |
