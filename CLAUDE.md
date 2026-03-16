# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS REST API for GymBro fitness app. Uses Supabase for auth (JWT validation) and PostgreSQL, Prisma as ORM.

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
npx supabase stop                   # Stop all
npx supabase status                 # Show URLs and keys

# Docker
docker-compose up --build           # Build & start API + run migrations
docker-compose down
docker-compose logs -f api          # Tail API logs
```

## Architecture

**NestJS modular architecture** — each feature is a self-contained module with controller, service, DTOs.

- **Auth** (`src/auth/`): Supabase JWT validation. `AuthGuard` validates `Authorization: Bearer <token>` via `supabase.auth.getUser(token)` and attaches user to `req.user`. Apply `@UseGuards(AuthGuard)` to protect routes.
- **Onboarding** (`src/onboarding/`): User fitness profile CRUD. Guarded.
- **Home** (`src/home/`): Dashboard aggregation, workout session lifecycle (proposed → active → completed). Guarded.
- **Prisma** (`src/prisma/`): Global module — `PrismaService` extends `PrismaClient`, available everywhere without importing.
- **Supabase** (`src/supabase/`): Global module — wraps `@supabase/supabase-js` client.
- **Common** (`src/common/`): `AppException` custom errors + `AppExceptionFilter` for standardized error JSON `{ error: { code, message } }`.

**Database**: PostgreSQL 17 via Supabase. Schema in `prisma/schema.prisma`. Migrations live in two places:
- `prisma/migrations/` — Prisma migrations
- `supabase/migrations/` — SQL migrations for RLS policies, functions, and Supabase-specific DDL

**Validation**: Global `ValidationPipe({ whitelist: true })` strips unknown properties. DTOs use `class-validator` decorators.

## Key Patterns

- All protected routes use `@UseGuards(AuthGuard)` — user ID comes from `req.user.id`
- Express request type is extended in `src/types/express.d.ts` to include `user`
- API port defaults to 3001 locally (`process.env.PORT ?? 3001`), 3000 in Docker
- Supabase RLS policies are defined in SQL migrations under `supabase/migrations/`
- The home dashboard uses a Postgres RPC function `get_home_dashboard()` defined in migrations

## Code Style

- Prettier: single quotes, trailing commas
- ESLint: flat config (`eslint.config.mjs`), relaxed `@typescript-eslint` (noExplicitAny allowed)

## Environment

Requires `.env` with `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` (service_role key from `npx supabase status`). See `.env.example`.

Supabase must be running before the API starts — it provides Postgres, Auth, and the Docker network (`supabase_network_gym-tracker`) that `docker-compose.yml` references.
