SUPABASE_PROJECT = gym-tracker

# ── Full Docker stack ──────────────────────────────────────────────────────────
.PHONY: up
up:
	docker-compose up --build -d

# ── Stop everything ───────────────────────────────────────────────────────────
.PHONY: down
down:
	docker-compose down

# ── Database helpers ──────────────────────────────────────────────────────────
.PHONY: migrate
migrate:
	npx prisma migrate dev

.PHONY: studio
studio:
	npx prisma studio

# ── Logs ──────────────────────────────────────────────────────────────────────
.PHONY: logs
logs:
	docker-compose logs -f api
