# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Refresh data/exercises.json from the private gym-bro-exercises repo.
# GITHUB_TOKEN is a fine-grained PAT (Contents: Read-only) scoped to Sined385/gym-bro-exercises.
# If unset, the bundled data/exercises.json is used as-is.
ARG GITHUB_TOKEN=""
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      apk add --no-cache git jq && \
      git clone --depth 1 \
        "https://x-access-token:${GITHUB_TOKEN}@github.com/Sined385/gym-bro-exercises.git" \
        /tmp/exercises && \
      jq -s '.' /tmp/exercises/exercises/*.json > /app/data/exercises.json && \
      COUNT=$(jq 'length' /app/data/exercises.json) && \
      rm -rf /tmp/exercises && \
      apk del git jq && \
      echo "Refreshed data/exercises.json from private repo (${COUNT} exercises)"; \
    else \
      echo "GITHUB_TOKEN not set; using bundled data/exercises.json"; \
    fi

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
COPY --from=builder /app/data                            ./data

EXPOSE 3000

CMD ["node", "scripts/start.js"]
