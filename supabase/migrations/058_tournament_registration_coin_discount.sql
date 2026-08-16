-- Spec §4 — a player may apply an SX Coin discount at registration. Coins
-- deducted, never a naira value trusted from the client: coin_discount_naira
-- is always server-computed as coins_used * NAIRA_PER_COIN and stored here
-- so confirmRegistration's Paystack-amount check (lib/tournaments/confirm.ts)
-- can verify the discounted amount instead of the full registration_fee.
ALTER TABLE public.tournament_registrations
  ADD COLUMN coins_used integer NOT NULL DEFAULT 0,
  ADD COLUMN coin_discount_naira integer NOT NULL DEFAULT 0;
