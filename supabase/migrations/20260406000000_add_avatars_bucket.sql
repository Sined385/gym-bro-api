-- Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow service_role (API) to upload avatars
CREATE POLICY "Service role can upload avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- Allow service role to update (upsert) avatars
CREATE POLICY "Service role can update avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars');

-- Anyone can view avatars (public bucket)
CREATE POLICY "Public avatar read access"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'avatars');
