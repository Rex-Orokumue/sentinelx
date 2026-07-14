-- Friendly match results — mirrors public.match_results: one row per
-- submitter, so a friendly match only reaches admin review once BOTH
-- the challenger and opponent have independently submitted their result.
-- Screenshot storage stores the PATH (not a public URL) — the bucket is
-- private, so the URL is generated fresh via createSignedUrl at render
-- time, exactly like match-evidence in app/admin/matches/[id]/review.
CREATE TABLE public.friendly_match_results (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  friendly_match_id uuid        NOT NULL REFERENCES public.friendly_matches(id) ON DELETE CASCADE,
  submitted_by      uuid        NOT NULL REFERENCES public.profiles(id),
  score_challenger  integer     NOT NULL,
  score_opponent    integer     NOT NULL,
  screenshot_url    text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (friendly_match_id, submitted_by)
);
CREATE INDEX ON public.friendly_match_results (friendly_match_id);
CREATE INDEX ON public.friendly_match_results (submitted_by);

ALTER TABLE public.friendly_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fmr_participant_or_staff_select" ON public.friendly_match_results
  FOR SELECT USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND auth.uid() IN (fm.challenger_id, fm.opponent_id)
    )
  );

-- A participant can only insert/update their OWN row, and only while the
-- match is still 'active' — once both sides have submitted (status moves
-- to awaiting_admin_confirmation) neither can add or edit a submission.
CREATE POLICY "fmr_participant_insert_while_active" ON public.friendly_match_results
  FOR INSERT WITH CHECK (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND fm.status = 'active'
        AND auth.uid() IN (fm.challenger_id, fm.opponent_id)
    )
  );
CREATE POLICY "fmr_own_update_while_active" ON public.friendly_match_results
  FOR UPDATE USING (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND fm.status = 'active'
    )
  );

-- friendly_matches.screenshot_url is superseded by per-submission
-- screenshots in friendly_match_results — drop the now-dead column.
ALTER TABLE public.friendly_matches DROP COLUMN screenshot_url;
