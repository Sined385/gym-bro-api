-- ============================================================
-- posts
-- ============================================================

CREATE TABLE public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'global',
    photo_url TEXT,
    workout_session_id UUID REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read global posts"
    ON public.posts FOR SELECT
    USING (visibility = 'global' OR user_id = auth.uid());

CREATE POLICY "Users can insert own posts"
    ON public.posts FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own posts"
    ON public.posts FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own posts"
    ON public.posts FOR DELETE
    USING (user_id = auth.uid());

CREATE INDEX idx_posts_user_created ON public.posts(user_id, created_at DESC);
CREATE INDEX idx_posts_visibility_created ON public.posts(visibility, created_at DESC);

-- ============================================================
-- post_likes
-- ============================================================

CREATE TABLE public.post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read post likes"
    ON public.post_likes FOR SELECT
    USING (true);

CREATE POLICY "Users can insert own likes"
    ON public.post_likes FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own likes"
    ON public.post_likes FOR DELETE
    USING (user_id = auth.uid());

-- ============================================================
-- post_comments
-- ============================================================

CREATE TABLE public.post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read post comments"
    ON public.post_comments FOR SELECT
    USING (true);

CREATE POLICY "Users can insert own comments"
    ON public.post_comments FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own comments"
    ON public.post_comments FOR DELETE
    USING (user_id = auth.uid());

CREATE INDEX idx_post_comments_post_created ON public.post_comments(post_id, created_at);

-- ============================================================
-- friendships
-- ============================================================

CREATE TABLE public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    addressee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(requester_id, addressee_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own friendships"
    ON public.friendships FOR SELECT
    USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE POLICY "Users can insert friendships as requester"
    ON public.friendships FOR INSERT
    WITH CHECK (requester_id = auth.uid());

CREATE POLICY "Users can update friendships they are part of"
    ON public.friendships FOR UPDATE
    USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE POLICY "Users can delete friendships they are part of"
    ON public.friendships FOR DELETE
    USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE INDEX idx_friendships_addressee_status ON public.friendships(addressee_id, status);
CREATE INDEX idx_friendships_requester_status ON public.friendships(requester_id, status);

-- ============================================================
-- Add body_weight_kg to onboarding_data
-- ============================================================

ALTER TABLE public.onboarding_data
    ADD COLUMN IF NOT EXISTS body_weight_kg DOUBLE PRECISION;
