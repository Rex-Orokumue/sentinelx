-- Add 'win_no_dispute' to the Sentinel Score event types.
-- The scoring model awards +1 for a win with no dispute as a distinct, fixed-delta
-- ledger row (never folded into match_completed). The constraint was created inline
-- and auto-named <table>_<column>_check.
ALTER TABLE public.sentinel_score_events
  DROP CONSTRAINT sentinel_score_events_event_type_check,
  ADD CONSTRAINT sentinel_score_events_event_type_check
    CHECK (event_type IN (
      'match_completed', 'win_no_dispute', 'no_show', 'rage_quit',
      'dispute_lost', 'rating_received', 'admin_flag_conduct', 'admin_flag_cheat'
    ));
