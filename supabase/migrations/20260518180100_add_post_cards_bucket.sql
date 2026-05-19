-- Storage bucket for rasterized share-card PNGs. Mirrors the post-photos bucket
-- pattern from 20260320000000_add_post_photos_bucket.sql.

INSERT INTO storage.buckets (id, name, public)
VALUES ('post-cards', 'post-cards', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload only into their own folder.
DROP POLICY IF EXISTS "Users can upload post card images" ON storage.objects;
CREATE POLICY "Users can upload post card images"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'post-cards' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read so og:image crawlers (Slack/iMessage/Twitter) can unfurl.
DROP POLICY IF EXISTS "Public read access for post card images" ON storage.objects;
CREATE POLICY "Public read access for post card images"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'post-cards');

-- Owners can delete their own; used by account deletion + edit/delete flows.
DROP POLICY IF EXISTS "Users can delete own post card images" ON storage.objects;
CREATE POLICY "Users can delete own post card images"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'post-cards' AND (storage.foldername(name))[1] = auth.uid()::text);
