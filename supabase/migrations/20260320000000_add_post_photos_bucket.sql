-- Create post-photos storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('post-photos', 'post-photos', true);

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload post photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'post-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow public read access
CREATE POLICY "Public read access for post photos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'post-photos');

-- Allow users to delete their own photos
CREATE POLICY "Users can delete own post photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'post-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
