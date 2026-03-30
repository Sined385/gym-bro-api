-- Analytics events table for server-side tracking
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_events_event_created ON analytics_events (event_name, created_at DESC);
CREATE INDEX idx_analytics_events_user_created ON analytics_events (user_id, created_at DESC);

-- RLS: service role only (no direct client access)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
