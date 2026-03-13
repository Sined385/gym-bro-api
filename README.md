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
  schema.prisma          # User model definition
supabase/
  config.toml            # Supabase CLI local project config
Dockerfile
docker-compose.yml
.env.example
```

---

## Prerequisites

- [Node.js](https://nodejs.org) 20.19+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- Supabase CLI — installed automatically via `npx`

---

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start Supabase local stack

```bash
npx supabase start
```

This spins up Postgres (port **54322**), the Supabase API gateway (port **54321**),
Auth, Storage, and the Studio dashboard.

At the end of the command, copy the **anon key** from the output:

```
API URL:      http://localhost:54321
anon key:     eyJhbGciOi...   <-- copy this
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and paste the `anon key` as `SUPABASE_KEY`.

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

## Running with Docker Compose

> Supabase must already be running locally (`npx supabase start`) so the
> containers can reach it via `host.docker.internal`.

```bash
docker-compose up --build
```

This will:
1. Build the NestJS image.
2. Run `prisma migrate deploy` in a one-shot `migrate` container.
3. Start the `api` container on port **3000**.

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
| `npm run start:dev`                | Start API in watch mode                  |
| `npm run build`                    | Compile TypeScript                       |
| `npx supabase start`               | Start local Supabase stack               |
| `npx supabase stop`                | Stop local Supabase stack                |
| `npx supabase status`              | Show service URLs and keys               |
| `npx prisma migrate dev`           | Create and apply a new migration         |
| `npx prisma migrate deploy`        | Apply pending migrations (CI/prod)       |
| `npx prisma studio`                | Open Prisma Studio GUI                   |
| `docker-compose up --build`        | Build & start API container              |
| `docker-compose down`              | Stop and remove containers               |
