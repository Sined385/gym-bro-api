# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS REST API for GymBro fitness app. Uses Supabase for auth (JWT validation) and PostgreSQL, Prisma as ORM, OpenAI for AI features.

## Common Commands

```bash
# Dev server (watch mode, port 3001)
npm run start:dev

# Build
npm run build

# Lint (auto-fix)
npm run lint

# Unit tests
npm test
npm run test:watch
npm run test:cov

# Single test file
npx jest src/auth/auth.service.spec.ts

# E2E tests
npm run test:e2e

# Database migrations
npx prisma migrate dev              # Create & apply migration
npx prisma migrate deploy           # Apply pending (CI/prod)
npx prisma studio                   # GUI for browsing data

# Supabase local stack (must run before API)
npx supabase start                  # Start Postgres, Auth, Kong, Studio
npx supabase stop
npx supabase status                 # Show URLs and keys

# Docker
docker-compose up --build           # Build & start API + run migrations
docker-compose down
```

## Architecture

**NestJS modular architecture** — each feature is a self-contained module with controller, service, DTOs.

### Modules

- **Auth** (`src/auth/`): Supabase JWT validation. `AuthGuard` validates `Authorization: Bearer <token>` via JWKS and attaches user to `req.user`. Apply `@UseGuards(AuthGuard)` to protect routes.
- **Onboarding** (`src/onboarding/`): User fitness profile CRUD (goal, sport, experience, frequency, equipment, injuries).
- **Home** (`src/home/`): Dashboard aggregation, workout session lifecycle (proposed → active → completed), exercise/set CRUD within sessions, weight suggestions, AI-generated motivation insights and quick workouts.
- **Coach** (`src/coach/`): AI coach chat via OpenAI with SSE streaming. Tool calls: `create_workout_session`, `modify_plan_day`. Manages `CoachConversation` + `CoachMessage` history.
- **Plans** (`src/plans/`): AI-generated weekly training plans. `PlansAiService` generates 7-day plans with OpenAI (fallback: deterministic templates). Auto-advances weeks. `startPlanSession()` creates WorkoutSession from PlanDay exercises.
- **Exercises** (`src/exercises/`): Exercise library (system + user-created), search/filter by muscle group and equipment.
- **Community** (`src/community/`): Social feed — posts, likes, comments, follows, friend requests, user profiles, photo uploads via Supabase Storage.
- **Notifications** (`src/notifications/`): Push notifications via Firebase Cloud Messaging. Device token management, notification CRUD.
- **Analytics** (`src/analytics/`): Event tracking — `track(userId, eventName, properties)`.
- **OpenAI** (`src/openai/`): Global module providing OpenAI client injection via `@Inject('OPENAI_CLIENT')`.
- **Prisma** (`src/prisma/`): Global module — `PrismaService` extends `PrismaClient`, available everywhere.
- **Supabase** (`src/supabase/`): Global module — wraps `@supabase/supabase-js` client.
- **Common** (`src/common/`): `AppException` + `AppExceptionFilter` for standardized error JSON `{ error: { code, message } }`.

### Module Dependencies

```
CoachModule → HomeModule (uses HomeService.startSession)
PlansModule → HomeModule (uses WeightSuggestionService)
HomeModule exports: HomeService, WeightSuggestionService
```

Do NOT import `PlansModule` from `HomeModule` — would create circular dependency.

### Key Services

**HomeService** (`src/home/home.service.ts`): Dashboard via `getDashboard()` aggregates user profile, week stats, quick workout, motivation, session history. Session lifecycle: `startSession()` → `completeSession()` (with calorie estimation, feedback, plan day linking, motivation cache invalidation).

**HomeAiService** (`src/home/home-ai.service.ts`): Per-day cached motivation insights. Background quick workout generation.

**CoachService** (`src/coach/coach.service.ts`): `chat()` is an async generator yielding SSE events. Builds system prompt with user profile, recent sessions, week stats, exercise library. Tool calls create sessions or modify plan days.

**PlansService** (`src/plans/plans.service.ts`): `getActivePlan()` returns current week (auto-advances if expired). `generatePlan()` uses AI with exercise library + weight suggestions. `startPlanSession()` creates WorkoutSession from PlanDay exercises and links them.

**WeightSuggestionService** (`src/home/weight-suggestion.service.ts`): Priority 1: user's exercise history. Priority 2: body-weight ratio estimates by muscle group/equipment/experience.

### Database

PostgreSQL 17 via Supabase. Schema in `prisma/schema.prisma`. Key models:
- `WorkoutSession` (status: proposed/active/completed) → `SessionExercise` → `ExerciseSet`
- `TrainingPlan` → `PlanDay` (day_type: training/rest, status: pending/completed, exercises_json)
- `CoachConversation` → `CoachMessage`
- `Post` → `PostLike`, `PostComment`

Migrations in two places:
- `prisma/migrations/` — Prisma migrations
- `supabase/migrations/` — RLS policies, functions, Supabase-specific DDL

### AI Integration

OpenAI (`gpt-4o` default, configurable via `OPENAI_MODEL` env var):
- Coach chat: streaming with tool calls
- Plan generation: JSON schema response format
- Motivation insights: cached per-day
- Quick workouts: background generation
- Plan completion notes: brief AI summaries

## Key Patterns

- All protected routes: `@UseGuards(AuthGuard)`, user ID from `req.user.id`
- Express request type extended in `src/types/express.d.ts`
- API port: 3001 locally, 3000 in Docker
- Date handling: `getDay()` (0=Sun) converted to 0=Mon via `day === 0 ? 6 : day - 1`
- Session exercise accent colors: `['#E86A75', '#30C08D', '#7A82F6', '#F5A623']` rotating
- Equipment mapping: `full_gym: []`, `dumbbells_only: ['Dumbbells', 'Bodyweight']`, `bodyweight: ['Bodyweight']`, `home_gym: ['Dumbbells', 'Bodyweight', 'Bands']`
- `safeParseToolArgs()` in coach service repairs truncated JSON from streamed tool calls

## Code Style

- Prettier: single quotes, trailing commas
- ESLint: flat config (`eslint.config.mjs`), relaxed `@typescript-eslint` (noExplicitAny allowed)

## Environment

Requires `.env` with `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` (service_role key), `OPENAI_API_KEY`. See `.env.example`.

Supabase must be running before the API starts — it provides Postgres, Auth, and the Docker network (`supabase_network_gym-tracker`).

## Exercise Library Source

`data/exercises.json` is consumed by `npm run seed:exercises` to populate the `exercise_library` table. The source of truth is the private repo `git@github.com:Sined385/gym-bro-exercises.git`.

- **Local refresh:** `npm run refresh:exercises` — uses sibling `../exercises/` working copy if present, otherwise clones via SSH. Rebuilds and overwrites `data/exercises.json`.
- **Docker build (local + Railway):** if `GITHUB_TOKEN` build arg is set, the Dockerfile clones the private repo via HTTPS during the builder stage and overwrites `data/exercises.json` before `npm run build`. If unset, the bundled JSON committed to this repo is used.
- **Railway:** add `GITHUB_TOKEN` to the service's variables (fine-grained PAT, Contents: Read-only, scoped only to `Sined385/gym-bro-exercises`). Railway passes any service variable whose name matches a Dockerfile `ARG` as a build arg automatically. Trigger a redeploy to pick up new exercise data.
- **Local docker-compose:** `export GITHUB_TOKEN=...` before `docker-compose up --build` to refresh during the image build. Unset → uses bundled JSON.
