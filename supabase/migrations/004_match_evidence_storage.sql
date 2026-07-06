-- Private bucket for match evidence screenshots.
INSERT INTO storage.buckets (id, name, public)
VALUES ('match-evidence', 'match-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may upload only into their own {uid}/... folder.
CREATE POLICY "match_evidence_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'match-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner or staff may read (reads normally go through server-side signed URLs).
CREATE POLICY "match_evidence_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'match-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff()
    )
  );
