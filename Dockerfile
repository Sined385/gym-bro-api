# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# data/exercises.json is the source of truth, committed to this repo.
# Updates flow: edit the JSON, run `npm run seed:exercises` against the
# target DB (idempotent UPSERT by external_id — UUIDs stay stable).
# The old GITHUB_TOKEN build-arg path that cloned gym-bro-exercises at
# build time is gone — destructive re-seeds on deploy were nulling
# every historical session_exercise.library_exercise_id FK.

RUN npx prisma generate && npm run build

# ── Stage 2: production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy manifests and install prod deps + prisma CLI (needed for migrate
# deploy) and ts-node/typescript (needed to run scripts/seed-exercise-
# library.ts on boot — see start.js step 3).
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm install --save-dev prisma ts-node typescript

# Copy compiled app, migration artefacts, and the generated Prisma client
COPY --from=builder /app/dist                           ./dist
COPY --from=builder /app/prisma                         ./prisma
COPY --from=builder /app/prisma.config.ts               ./prisma.config.ts
COPY --from=builder /app/generated                      ./generated
COPY --from=builder /app/supabase/migrations             ./supabase/migrations
COPY --from=builder /app/scripts                         ./scripts
COPY --from=builder /app/data                            ./data

EXPOSE 3000

CMD ["node", "scripts/start.js"]
