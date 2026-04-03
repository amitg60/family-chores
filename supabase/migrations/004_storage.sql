-- Note: bucket must be created via Dashboard or Management API.
-- These policies apply once the bucket exists.

-- Storage RLS policies for completion-photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('completion-photos', 'completion-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "completion_photos: player can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'completion-photos'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "completion_photos: admins and owners can view"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'completion-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
      )
    )
  );

CREATE POLICY "completion_photos: service role can delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'completion-photos');
