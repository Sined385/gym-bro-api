# GymBro Onboarding API Specification

Backend API contract for the onboarding flow. The iOS client currently uses Supabase directly, but this document defines the API endpoints needed if migrating to a custom backend.

---

## Authentication

All onboarding endpoints require a valid JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

The `user_id` is extracted from the JWT claims (`sub` field). Users can only access their own onboarding data.

---

## Endpoints

### 1. Save/Update Onboarding Data

**`PUT /api/v1/onboarding`**

Creates or updates the onboarding record for the authenticated user (upsert by `user_id`).

#### Request Body

```json
{
  "primary_goal": "build_muscle",
  "primary_sport": "Gym / Weightlifting",
  "experience_level": "intermediate",
  "training_frequency": 4,
  "workout_duration": 60,
  "available_equipment": "full_gym",
  "injuries": [
    { "type": "shoulders", "value": "Shoulders / Rotator Cuff" },
    { "type": "custom", "value": "ACL tear recovery" }
  ],
  "completed_at": "2026-03-12T14:30:00Z"
}
```

#### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `primary_goal` | `string` (enum) | Yes | User's primary fitness goal |
| `primary_sport` | `string` | Yes | User's primary sport (free text, may be preset or custom) |
| `experience_level` | `string` (enum) | Yes | Training experience level |
| `training_frequency` | `integer` | Yes | Days per week (1-7) |
| `workout_duration` | `integer` | Yes | Session length in minutes (30, 45, 60, or 90) |
| `available_equipment` | `string` (enum) | Yes | Equipment access type |
| `injuries` | `array[object]` | No | List of injuries. Empty array `[]` or omitted means no injuries |
| `completed_at` | `string` (ISO 8601) | Yes | Timestamp when user completed onboarding |

#### Enum Values

**`primary_goal`:**
| Value | Display Name |
|---|---|
| `build_muscle` | Build Muscle |
| `lose_fat` | Lose Fat |
| `recomposition` | Recomposition |
| `improve_endurance` | Improve Endurance |
| `general_fitness` | General Fitness |

**`experience_level`:**
| Value | Display Name | Description |
|---|---|---|
| `beginner` | Beginner | 0-1 years experience |
| `intermediate` | Intermediate | 1-3 years experience |
| `advanced` | Advanced | 3+ years experience |

**`training_frequency`:**
Integer from 1 to 7 representing days per week.

| Value | Label |
|---|---|
| 1 | 1 Day |
| 2 | 2 Days |
| 3 | 3 Days |
| 4 | 4 Days |
| 5 | 5 Days |
| 6 | 6 Days |
| 7 | 7 Days |

**`workout_duration`:**
Integer representing minutes per session. Only these values are valid:

| Value | Display Name |
|---|---|
| 30 | 30 minutes |
| 45 | 45 minutes |
| 60 | 60 minutes |
| 90 | 90+ minutes |

**`available_equipment`:**
| Value | Display Name |
|---|---|
| `full_gym` | Full Gym |
| `dumbbells_only` | Dumbbells Only |
| `bodyweight` | Bodyweight |
| `home_gym` | Home Gym |

#### Injuries Array

Each injury object has:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | Yes | Injury identifier (see values below) |
| `value` | `string` | Yes | Human-readable display name or custom text |

**Standard injury types:**
| type | value |
|---|---|
| `none` | None |
| `shoulders` | Shoulders / Rotator Cuff |
| `lower_back` | Lower Back |
| `knees` | Knees |
| `wrists` | Wrists |
| `custom` | *(user-provided text)* |

**Injury business rules:**
- `none` is mutually exclusive with all other injury types. If `none` is present, no other injuries should be in the array.
- Multiple standard injuries can be selected simultaneously (e.g., `shoulders` + `knees`).
- Multiple `custom` injuries are allowed, each with different `value` text.
- The array can be empty `[]`, which is equivalent to having `[{"type": "none", "value": "None"}]`.

#### Response

**Success (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "primary_goal": "build_muscle",
  "primary_sport": "Gym / Weightlifting",
  "experience_level": "intermediate",
  "training_frequency": 4,
  "workout_duration": 60,
  "available_equipment": "full_gym",
  "injuries": [
    { "type": "shoulders", "value": "Shoulders / Rotator Cuff" }
  ],
  "completed_at": "2026-03-12T14:30:00Z",
  "created_at": "2026-03-12T14:30:00Z",
  "updated_at": "2026-03-12T14:30:00Z"
}
```

**Errors:**

| Status | Code | Description |
|---|---|---|
| 400 | `invalid_primary_goal` | `primary_goal` is not a valid enum value |
| 400 | `invalid_experience_level` | `experience_level` is not a valid enum value |
| 400 | `invalid_training_frequency` | `training_frequency` not between 1-7 |
| 400 | `invalid_workout_duration` | `workout_duration` not in [30, 45, 60, 90] |
| 400 | `invalid_equipment` | `available_equipment` is not a valid enum value |
| 400 | `missing_required_field` | A required field is missing or null |
| 400 | `invalid_primary_sport` | `primary_sport` is empty or whitespace-only |
| 401 | `not_authenticated` | Missing or invalid JWT token |
| 500 | `server_error` | Internal server error |

**Error response format:**
```json
{
  "error": {
    "code": "invalid_training_frequency",
    "message": "training_frequency must be between 1 and 7"
  }
}
```

---

### 2. Fetch Onboarding Data

**`GET /api/v1/onboarding`**

Retrieves the onboarding record for the authenticated user.

#### Response

**Success with data (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "primary_goal": "build_muscle",
  "primary_sport": "Gym / Weightlifting",
  "experience_level": "intermediate",
  "training_frequency": 4,
  "workout_duration": 60,
  "available_equipment": "full_gym",
  "injuries": [
    { "type": "shoulders", "value": "Shoulders / Rotator Cuff" }
  ],
  "completed_at": "2026-03-12T14:30:00Z",
  "created_at": "2026-03-12T14:30:00Z",
  "updated_at": "2026-03-12T14:30:00Z"
}
```

**No onboarding data found (200 OK):**
```json
null
```

> The client uses a `null` response to determine the user hasn't completed onboarding and should be routed to the onboarding flow.

**Errors:**

| Status | Code | Description |
|---|---|---|
| 401 | `not_authenticated` | Missing or invalid JWT token |
| 500 | `server_error` | Internal server error |

---

### 3. Check Onboarding Status

**`GET /api/v1/onboarding/status`**

Lightweight endpoint to check if onboarding is complete without fetching all data.

#### Response

**Success (200 OK):**
```json
{
  "has_completed_onboarding": true
}
```

> Returns `true` only when a record exists AND all required fields are non-null (i.e., `completed_at` is set).

**Errors:**

| Status | Code | Description |
|---|---|---|
| 401 | `not_authenticated` | Missing or invalid JWT token |
| 500 | `server_error` | Internal server error |

---

### 4. Delete Onboarding Data

**`DELETE /api/v1/onboarding`**

Deletes the onboarding record for the authenticated user. Used during account deletion flow.

#### Response

**Success (204 No Content):** Empty body.

**Errors:**

| Status | Code | Description |
|---|---|---|
| 401 | `not_authenticated` | Missing or invalid JWT token |
| 404 | `not_found` | No onboarding record found |
| 500 | `server_error` | Internal server error |

---

## Database Schema

### Table: `onboarding_data`

```sql
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
```

### Validation Constraints

| Column | Constraint |
|---|---|
| `user_id` | NOT NULL, UNIQUE, FK to `auth.users(id)` ON DELETE CASCADE |
| `primary_goal` | NOT NULL, must be one of: `build_muscle`, `lose_fat`, `recomposition`, `improve_endurance`, `general_fitness` |
| `primary_sport` | NOT NULL, non-empty string |
| `experience_level` | NOT NULL, must be one of: `beginner`, `intermediate`, `advanced` |
| `training_frequency` | NOT NULL, integer BETWEEN 1 AND 7 |
| `workout_duration` | NOT NULL, integer IN (30, 45, 60, 90) |
| `available_equipment` | NOT NULL, must be one of: `full_gym`, `dumbbells_only`, `bodyweight`, `home_gym` |
| `injuries` | JSONB array, defaults to `[]` |
| `completed_at` | Nullable. Set when user finishes onboarding |

### Row Level Security

All operations scoped to `auth.uid() = user_id`:
- **SELECT**: User can read only their own record
- **INSERT**: User can insert only their own record
- **UPDATE**: User can update only their own record
- **DELETE**: User can delete only their own record

---

## Client Flow Summary

```
1. User signs in (Apple/Google OAuth)
   └── POST /auth/v1/token (handled by Supabase Auth)

2. App checks onboarding status
   └── GET /api/v1/onboarding/status
       ├── { "has_completed_onboarding": true }  → Navigate to Home
       └── { "has_completed_onboarding": false } → Navigate to Onboarding

3. User completes 7-step onboarding (steps 2-8):
   Step 2: Select primary_goal
   Step 3: Select/enter primary_sport
   Step 4: Select experience_level
   Step 5: Select training_frequency
   Step 6: Select workout_duration
   Step 7: Select available_equipment
   Step 8: Select injuries (optional)

4. User taps "Build My Plan"
   └── PUT /api/v1/onboarding
       Body: { all fields + completed_at }

5. Success → Navigate to Home screen

6. Returning user flow:
   App launch → Restore session → Check status → Route accordingly
```

---

## Example Payloads

### Minimal (no injuries):
```json
{
  "primary_goal": "general_fitness",
  "primary_sport": "Running",
  "experience_level": "beginner",
  "training_frequency": 3,
  "workout_duration": 30,
  "available_equipment": "bodyweight",
  "injuries": [],
  "completed_at": "2026-03-12T10:00:00Z"
}
```

### Full (multiple injuries including custom):
```json
{
  "primary_goal": "build_muscle",
  "primary_sport": "Gym / Weightlifting",
  "experience_level": "advanced",
  "training_frequency": 6,
  "workout_duration": 90,
  "available_equipment": "full_gym",
  "injuries": [
    { "type": "shoulders", "value": "Shoulders / Rotator Cuff" },
    { "type": "lower_back", "value": "Lower Back" },
    { "type": "custom", "value": "Tennis elbow" },
    { "type": "custom", "value": "Plantar fasciitis" }
  ],
  "completed_at": "2026-03-12T14:30:00Z"
}
```

### Custom sport:
```json
{
  "primary_goal": "improve_endurance",
  "primary_sport": "Rock Climbing",
  "experience_level": "intermediate",
  "training_frequency": 4,
  "workout_duration": 60,
  "available_equipment": "full_gym",
  "injuries": [
    { "type": "wrists", "value": "Wrists" }
  ],
  "completed_at": "2026-03-12T12:00:00Z"
}
```

### Preset sports expected from client:
- `Gym / Weightlifting`
- `Running`
- `Cycling`
- `Swimming`
- `CrossFit`

> Note: `primary_sport` is free text. Backend should accept any non-empty string. The above are the preset options shown in the iOS UI, but users can also enter custom text.
