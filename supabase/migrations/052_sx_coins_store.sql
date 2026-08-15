-- 052_sx_coins_store.sql (renumbered from 051 - see commit msg)
-- Phase 2 Economy §3: SX Coins balance + ledger, and the cosmetics Store
-- catalogue + player inventory. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §3.

CREATE TABLE public.sx_coins (
  player_id    uuid    PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance      integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned integer NOT NULL DEFAULT 0,
  total_spent  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sx_coins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_coins_read" ON public.sx_coins
  FOR SELECT USING (auth.uid() = player_id);
-- No client write policy — every write is via awardCoins()/purchaseStoreItem()'s service-role client.

CREATE TABLE public.sx_coin_transactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount       integer     NOT NULL,
  balance_after integer    NOT NULL,
  source       text        NOT NULL CHECK (source IN (
    'match_played', 'match_won', 'tournament_placement',
    'daily_login', 'login_streak', 'achievement_unlocked',
    'store_purchase', 'community_activity',
    'admin_grant', 'admin_deduct'
  )),
  reference_id uuid,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.sx_coin_transactions (player_id);

ALTER TABLE public.sx_coin_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_coin_transactions_read" ON public.sx_coin_transactions
  FOR SELECT USING (auth.uid() = player_id);

CREATE TABLE public.store_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  description  text,
  category     text    NOT NULL CHECK (category IN (
    'avatar_border', 'profile_theme', 'username_colour', 'bubble_skin'
  )),
  price_coins  integer NOT NULL CHECK (price_coins > 0),
  preview_url  text,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_items ENABLE ROW LEVEL SECURITY;
-- Public catalogue — everyone browsing /store reads it; only active items
-- are filtered in the query layer, not RLS, so admin can still see inactive
-- ones on /admin/store via the service-role client.
CREATE POLICY "store_items_read" ON public.store_items
  FOR SELECT USING (true);

CREATE TABLE public.player_store_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id      uuid        NOT NULL REFERENCES public.store_items(id),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  equipped     boolean     NOT NULL DEFAULT false,
  UNIQUE (player_id, item_id)
);

CREATE INDEX ON public.player_store_items (player_id);

ALTER TABLE public.player_store_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_store_items_read" ON public.player_store_items
  FOR SELECT USING (true);
-- Public read (not owner-only): equipped cosmetics render on the public
-- profile page, so any visitor must be able to look up who owns/has
-- equipped what. No client write policy — purchaseStoreItem/equipStoreItem
-- use the service-role client exclusively.

INSERT INTO public.store_items (slug, name, description, category, price_coins, sort_order) VALUES
  ('avatar_border_bronze', 'Bronze Frame', 'A modest bronze ring around your avatar.', 'avatar_border', 150, 1),
  ('avatar_border_purple_glow', 'Purple Glow', 'A pulsing purple aura for your avatar.', 'avatar_border', 300, 2),
  ('avatar_border_gold_crown', 'Gold Crown', 'A crowned gold frame for certified legends.', 'avatar_border', 500, 3),
  ('theme_dark_void', 'Dark Void', 'A minimal black profile card background.', 'profile_theme', 250, 1),
  ('theme_neon_grid', 'Neon Grid', 'A cyberpunk neon-grid profile card background.', 'profile_theme', 500, 2),
  ('theme_lagos_skyline', 'Lagos Skyline', 'The Lagos skyline at dusk behind your card.', 'profile_theme', 800, 3),
  ('username_purple', 'Purple Username', 'Show your username in Sentinel purple.', 'username_colour', 150, 1),
  ('username_gold', 'Gold Username', 'Show your username in gold.', 'username_colour', 150, 2),
  ('username_red', 'Red Username', 'Show your username in red.', 'username_colour', 150, 3),
  ('username_teal', 'Teal Username', 'Show your username in teal.', 'username_colour', 150, 4),
  ('bubble_classic_mascot', 'Classic Mascot', 'The original Sentinel guide bubble.', 'bubble_skin', 300, 1),
  ('bubble_neon_mascot', 'Neon Mascot', 'A neon-outlined mascot skin.', 'bubble_skin', 450, 2),
  ('bubble_gold_mascot', 'Gold Mascot', 'A gold-plated mascot skin for top spenders.', 'bubble_skin', 600, 3);
