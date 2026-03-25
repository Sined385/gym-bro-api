-- Device tokens for FCM push notifications
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    platform TEXT NOT NULL DEFAULT 'ios',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read_date ON notifications(user_id, is_read, created_at DESC);

-- RLS policies for device_tokens
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own device tokens"
    ON device_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own device tokens"
    ON device_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own device tokens"
    ON device_tokens FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own device tokens"
    ON device_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- Service role can manage all device tokens (for FCM token cleanup)
CREATE POLICY "Service role full access to device tokens"
    ON device_tokens FOR ALL
    USING (auth.role() = 'service_role');

-- RLS policies for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
    ON notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role can manage all notifications (for backend insertion)
CREATE POLICY "Service role full access to notifications"
    ON notifications FOR ALL
    USING (auth.role() = 'service_role');
