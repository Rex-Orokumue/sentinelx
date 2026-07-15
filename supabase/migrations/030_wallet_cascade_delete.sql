-- Root-cause fix: deleting a user (auth.users -> profiles cascade) was failing
-- with a wallets_player_id_fkey violation. A wallet/ledger is owned 1:1 by its
-- profile with no cross-user references (unlike matches, orders, posts, etc.,
-- which intentionally stay RESTRICT so deleting one player doesn't corrupt
-- another player's history) — so cascading it is safe, mirroring how
-- user_roles and player_kyc already cascade.
ALTER TABLE public.wallets
  DROP CONSTRAINT wallets_player_id_fkey,
  ADD CONSTRAINT wallets_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT wallet_transactions_player_id_fkey,
  ADD CONSTRAINT wallet_transactions_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
