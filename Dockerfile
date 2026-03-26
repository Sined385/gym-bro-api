# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# ── Stage 2: production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy manifests and install prod deps + prisma CLI (needed for migrate deploy)
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm install --save-dev prisma

# Copy compiled app, migration artefacts, and the generated Prisma client
COPY --from=builder /app/dist                           ./dist
COPY --from=builder /app/prisma                         ./prisma
COPY --from=builder /app/prisma.config.ts               ./prisma.config.ts
COPY --from=builder /app/generated                      ./generated
COPY --from=builder /app/supabase/migrations             ./supabase/migrations
COPY --from=builder /app/scripts                         ./scripts

EXPOSE 3000

CMD npx prisma migrate deploy && node scripts/apply-supabase-migrations.js && node dist/src/main
