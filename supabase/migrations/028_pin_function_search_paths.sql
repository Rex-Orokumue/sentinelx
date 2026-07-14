-- Pins search_path on functions flagged by the Supabase security advisor
-- (function_search_path_mutable). All four already fully schema-qualify
-- every reference (public.matches, public.profiles, public.is_staff()),
-- so this is a pure hardening change with no behavior difference.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.player_rank(text) SET search_path = '';
ALTER FUNCTION public.enforce_listing_status() SET search_path = '';
ALTER FUNCTION public.expire_full_day_matches() SET search_path = '';
