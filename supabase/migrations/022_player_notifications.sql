CREATE TABLE public.player_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id),
  type       text        NOT NULL
               CHECK (type IN (
                 'listing_approved', 'listing_removed',
                 'withdrawal_paid', 'withdrawal_rejected',
                 'referral_withdrawal_paid', 'referral_withdrawal_rejected',
                 'result_confirmed', 'referral_credited',
                 'friend_request'
               )),
  title      text        NOT NULL,
  body       text        NOT NULL,
  link       text,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.player_notifications (player_id, created_at DESC);

ALTER TABLE public.player_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_notifications_self_read" ON public.player_notifications
  FOR SELECT USING (player_id = auth.uid());
-- Self-update exists only so a player can mark their own notification read;
-- the client action only ever touches the `read` column.
CREATE POLICY "player_notifications_self_update" ON public.player_notifications
  FOR UPDATE USING (player_id = auth.uid());
-- No INSERT policy at all — writes only via notifyInApp()'s service-role client.
