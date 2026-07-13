-- =============================================================
-- Friend system
-- =============================================================
CREATE TABLE public.friends (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid        NOT NULL REFERENCES public.profiles(id),
  recipient_id uuid        NOT NULL REFERENCES public.profiles(id),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, recipient_id)
);
CREATE INDEX ON public.friends (requester_id);
CREATE INDEX ON public.friends (recipient_id);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friends_participant_read" ON public.friends
  FOR SELECT USING (requester_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "friends_requester_insert" ON public.friends
  FOR INSERT WITH CHECK (requester_id = auth.uid() AND status = 'pending');
-- Recipient accepts by flipping status; requester never updates their own request.
CREATE POLICY "friends_recipient_update" ON public.friends
  FOR UPDATE USING (recipient_id = auth.uid());
-- Either side can delete: requester cancels a pending request, recipient
-- declines a pending request, either side removes an accepted friendship.
CREATE POLICY "friends_participant_delete" ON public.friends
  FOR DELETE USING (requester_id = auth.uid() OR recipient_id = auth.uid());

-- =============================================================
-- Friendly matches — one table for the whole challenge -> match lifecycle
-- =============================================================
CREATE TABLE public.friendly_matches (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id                  uuid        NOT NULL REFERENCES public.profiles(id),
  opponent_id                    uuid        NOT NULL REFERENCES public.profiles(id),
  stake_amount                   integer     CHECK (stake_amount IS NULL OR stake_amount > 0),
  status                         text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                      'pending', 'declined', 'awaiting_payment', 'active',
                                      'awaiting_admin_confirmation', 'completed', 'disputed'
                                    )),
  challenger_paid                boolean     NOT NULL DEFAULT false,
  opponent_paid                  boolean     NOT NULL DEFAULT false,
  challenger_paystack_reference  text UNIQUE,
  opponent_paystack_reference    text UNIQUE,
  game_code                      text,
  score_challenger                integer,
  score_opponent                   integer,
  screenshot_url                   text,
  winner_id                        uuid        REFERENCES public.profiles(id),
  admin_note                       text,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  completed_at                     timestamptz
);
CREATE INDEX ON public.friendly_matches (challenger_id);
CREATE INDEX ON public.friendly_matches (opponent_id);
CREATE INDEX ON public.friendly_matches (status);

ALTER TABLE public.friendly_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendly_matches_participant_or_staff_read" ON public.friendly_matches
  FOR SELECT USING (challenger_id = auth.uid() OR opponent_id = auth.uid() OR public.is_staff());
CREATE POLICY "friendly_matches_challenger_insert" ON public.friendly_matches
  FOR INSERT WITH CHECK (challenger_id = auth.uid() AND status = 'pending');
-- Opponent accepts/declines; either participant later submits a result or
-- fills in the game code while active; admin confirms/disputes. All narrower
-- than this at the Server Action layer (matches the existing codebase
-- convention of app-level state-transition guards over fine-grained RLS).
CREATE POLICY "friendly_matches_participant_or_staff_update" ON public.friendly_matches
  FOR UPDATE USING (challenger_id = auth.uid() OR opponent_id = auth.uid() OR public.is_staff());

-- =============================================================
-- Staked-match withdrawal balance — mirrors referral_withdrawal_requests
-- exactly. Flagged in the design spec: this is the THIRD near-identical
-- withdrawal table (prize, referral, now staked-friendly) — a unified
-- withdrawal system should be seriously considered before a fourth is added.
-- =============================================================
CREATE TABLE public.friendly_withdrawal_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer     NOT NULL CHECK (amount > 0),
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.friendly_withdrawal_requests (player_id);
CREATE INDEX ON public.friendly_withdrawal_requests (status);

CREATE UNIQUE INDEX friendly_withdrawal_requests_one_pending_per_player
  ON public.friendly_withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.friendly_withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fwr_own_insert" ON public.friendly_withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');
CREATE POLICY "fwr_own_or_admin_read" ON public.friendly_withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "fwr_admin_update" ON public.friendly_withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- =============================================================
-- player_notifications.type CHECK extended for the two new event types
-- this feature adds (friendly_withdrawal_paid/rejected) — reusing the
-- existing withdrawal_paid/rejected values here would make the notification
-- feed unable to distinguish a prize-withdrawal notification from a
-- staked-friendly one; referral withdrawals got their own dedicated types
-- for the same reason, so this follows that precedent.
-- =============================================================
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'referral_withdrawal_paid', 'referral_withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request',
    'friendly_withdrawal_paid', 'friendly_withdrawal_rejected'
  ));

-- =============================================================
-- Private bucket for friendly-match result screenshots — mirrors the
-- existing match-evidence bucket's policy shape exactly.
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('friendly-match-evidence', 'friendly-match-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "friendly_match_evidence_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'friendly-match-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "friendly_match_evidence_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'friendly-match-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff()
    )
  );
