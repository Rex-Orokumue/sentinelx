-- Spec §5 — coin-denominated community wagering on SentinelX matches. A
-- structural mirror of match_bets/lib/betting (042_match_betting.sql) but
-- entirely coin-denominated: no naira anywhere in this table or its
-- settlement path.
CREATE TABLE public.match_wagers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  bettor_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pick_player_id uuid        NOT NULL REFERENCES public.profiles(id),
  stake_coins    integer     NOT NULL CHECK (stake_coins >= 50 AND stake_coins <= 2000),
  payout_coins   integer,
  status         text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','won','lost','refunded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, bettor_id)
);

CREATE INDEX ON public.match_wagers (match_id);

ALTER TABLE public.match_wagers ENABLE ROW LEVEL SECURITY;

-- Public odds visibility — anyone can read aggregate/individual wagers.
CREATE POLICY "match_wagers_read" ON public.match_wagers FOR SELECT USING (true);

-- Payout + status transitions are service-role only (admin result
-- confirmation drives settlement) — players never write those columns
-- directly, so there is no player-facing UPDATE/INSERT policy here. Writes
-- from placeWager/settleMatchWagers/refundMatchWagers all go through
-- createAdminClient(), same as tournament_registrations (see
-- lib/tournaments/actions.ts's comment on why).

-- Platform coin reserve — 5% wager fee pool (spec §5), future giveaways/Best
-- Play prizes. No RLS write policy for players; read is admin-only for now
-- (no UI surfaces this table in this extension).
CREATE TABLE public.platform_coin_reserve (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid        REFERENCES public.matches(id),
  coins      integer     NOT NULL,
  source     text        NOT NULL DEFAULT 'wager_fee',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_coin_reserve ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_coin_reserve_staff_read" ON public.platform_coin_reserve
  FOR SELECT USING (public.is_staff());
