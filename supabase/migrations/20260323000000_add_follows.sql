-- Create follows table for unidirectional follow system
CREATE TABLE public.follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    following_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read follows they are part of"
    ON public.follows FOR SELECT
    USING (follower_id = auth.uid() OR following_id = auth.uid());

CREATE POLICY "Users can insert own follows"
    ON public.follows FOR INSERT
    WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can delete own follows"
    ON public.follows FOR DELETE
    USING (follower_id = auth.uid());

CREATE INDEX idx_follows_follower ON public.follows(follower_id);
CREATE INDEX idx_follows_following ON public.follows(following_id);

-- Migrate accepted friendships to follows (both directions)
INSERT INTO public.follows (follower_id, following_id)
SELECT requester_id, addressee_id FROM public.friendships WHERE status = 'accepted'
ON CONFLICT DO NOTHING;
INSERT INTO public.follows (follower_id, following_id)
SELECT addressee_id, requester_id FROM public.friendships WHERE status = 'accepted'
ON CONFLICT DO NOTHING;
