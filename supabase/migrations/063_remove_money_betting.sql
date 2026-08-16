-- Real-money (naira) betting removed — zero rows in match_bets in
-- production at removal time (confirmed via execute_sql), so this is a
-- clean drop, not a data migration. Coin wagering (match_wagers) is
-- untouched and is now the only betting mechanism.
DROP TABLE public.match_bets;
ALTER TABLE public.matches DROP COLUMN betting_locked;
