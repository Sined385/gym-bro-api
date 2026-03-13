# Gym Tracker — Backend API

NestJS REST API backed by Supabase (Auth, Database, Storage) and Prisma ORM.

---

## Tech Stack

| Layer        | Technology                         |
|--------------|------------------------------------|
| Framework    | NestJS + TypeScript                |
| ORM          | Prisma 7 (PostgreSQL)              |
| Auth         | Supabase Auth (JWT validation)     |
| Local infra  | Supabase CLI                       |
| Containers   | Docker / docker-compose            |

---

## Running with Docker Compose

This is the primary way to run the application. Docker Compose handles migrations and starts the API automatically.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- [Node.js](https://nodejs.org) 20.19+ (needed to run Supabase CLI via `npx`)

### Step 1 — Start the Supabase infrastructure

Supabase CLI runs the entire local backend stack (Postgres, Auth, Storage, API gateway) as Docker containers and creates the Docker network that the API containers join.

```bash
npx supabase start
```

Wait until the command finishes. It prints a summary like this:

```
API URL:         http://127.0.0.1:54321
DB URL:          postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:      http://127.0.0.1:54323
anon key:        eyJhbGciOi...
service_role key: eyJhbGciOi...   <-- copy this
```

> **Why this must run first:** `docker-compose.yml` declares the network
> `supabase_network_gym-tracker` as `external: true`. This network is created
> by `npx supabase start`. If Supabase is not running, Docker Compose will
> fail with a "network not found" error.

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and paste the **service_role key** from the Supabase output as `SUPABASE_KEY`:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_KEY="eyJhbGciOi..."   # service_role key from `npx supabase start`
```

> The `.env` file is loaded by the `api` container via `env_file`. `DATABASE_URL`
> and `SUPABASE_URL` are overridden inside `docker-compose.yml` to use internal
> Docker network hostnames, so their values in `.env` are used only for local
> development without Docker.

### Step 3 — Build and start the API

```bash
docker-compose up --build
```

Docker Compose will:
1. Build the NestJS image (multi-stage, node:20-alpine).
2. Run `prisma migrate deploy` in a one-shot `migrate` container — applies all pending migrations against the Supabase Postgres instance.
3. Start the `api` container on port **3000** once the migration succeeds.

The API is available at **http://localhost:3000**.

### Stopping

```bash
docker-compose down
```

To also stop Supabase:

```bash
npx supabase stop
```

---

## Local Development (without Docker)

### 1. Install dependencies

```bash
npm install
```

### 2. Start Supabase local stack

```bash
npx supabase start
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Paste the **service_role key** from the Supabase output as `SUPABASE_KEY` in `.env`.

### 4. Run database migrations

```bash
npx prisma migrate dev --name init
```

### 5. Start the API in watch mode

```bash
npm run start:dev
```

The API will be available at **http://localhost:3000**.

---

## Project Structure

```
src/
  auth/
    auth.guard.ts        # Validates Supabase JWT on every protected route
    auth.module.ts
  prisma/
    prisma.service.ts    # PrismaClient singleton (connects on init)
    prisma.module.ts     # Global module — no need to re-import elsewhere
  supabase/
    supabase.service.ts  # Supabase JS client wrapper
    supabase.module.ts   # Global module
  app.module.ts          # Root module — wires ConfigModule, Prisma, Supabase, Auth
  main.ts
prisma/
  schema.prisma          # Database schema
supabase/
  config.toml            # Supabase CLI local project config (project_id: gym-tracker)
Dockerfile
docker-compose.yml
.env.example
```

---

## Supabase Infrastructure Details

`npx supabase start` spins up the following services locally:

| Service        | URL / Port                    | Description                              |
|----------------|-------------------------------|------------------------------------------|
| API Gateway    | http://127.0.0.1:54321        | Kong — routes to Auth, Storage, REST     |
| Postgres       | postgresql://...@127.0.0.1:54322 | Main database                         |
| Studio         | http://127.0.0.1:54323        | Web UI for browsing data & running SQL   |
| Inbucket       | http://127.0.0.1:54324        | Email testing inbox                      |
| Analytics      | port 54327                    | Internal analytics backend               |

The CLI also creates a Docker network named **`supabase_network_gym-tracker`**. The `api` and `migrate` containers in `docker-compose.yml` attach to this network so they can reach Postgres at `supabase_db_gym-tracker:5432` and Kong at `supabase_kong_gym-tracker:8000` using container hostnames — no `host.docker.internal` needed.

To check running services and retrieve keys at any time:

```bash
npx supabase status
```

---

## Using the AuthGuard

Apply `AuthGuard` to any controller or route that requires authentication:

```typescript
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  @Get()
  getProfile(@Req() req) {
    return req.user; // Supabase User object
  }
}
```

The guard expects an `Authorization: Bearer <supabase-access-token>` header.

---

## Useful Commands

| Command                            | Description                              |
|------------------------------------|------------------------------------------|
| `docker-compose up --build`        | Build & start API + run migrations       |
| `docker-compose down`              | Stop and remove containers               |
| `npx supabase start`               | Start local Supabase stack               |
| `npx supabase stop`                | Stop local Supabase stack                |
| `npx supabase status`              | Show service URLs and keys               |
| `npm run start:dev`                | Start API in watch mode (local dev)      |
| `npm run build`                    | Compile TypeScript                       |
| `npx prisma migrate dev`           | Create and apply a new migration         |
| `npx prisma migrate deploy`        | Apply pending migrations (CI/prod)       |
| `npx prisma studio`                | Open Prisma Studio GUI                   |
