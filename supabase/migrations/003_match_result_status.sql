-- Match-result submission workflow: status + one-row-per-participant + owner edit.
ALTER TABLE public.match_results
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'verified', 'disputed'));

ALTER TABLE public.match_results
  ADD CONSTRAINT match_results_match_submitter_unique UNIQUE (match_id, submitted_by);

-- A participant may edit their own submission only while it is still pending.
CREATE POLICY "mr_own_update_pending" ON public.match_results
  FOR UPDATE
  USING (submitted_by = auth.uid() AND status = 'pending')
  WITH CHECK (submitted_by = auth.uid());
