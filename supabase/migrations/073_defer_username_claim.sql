-- 073_defer_username_claim.sql
-- Stop claiming the username at signup.
--
-- Previously handle_new_user() wrote raw_user_meta_data->>'username' straight
-- into profiles.username the instant the auth.users row was created — before
-- the email was ever confirmed. A signup whose confirmation email bounced,
-- was suppressed, or never arrived then held that username (and its email
-- address) forever, and the person retrying got "that username is taken".
-- Email delivery has been failing for a large share of signups (unrelated
-- sending domain vs. the Sentinel X brand, a rate limit shared with another
-- app on the same Supabase project), so this was a steady drip of dead rows
-- locking real handles — Hardexfc, LIVERPOOL, dlsmamba, Kylian all burned
-- this way, their owners now playing under suffixed names.
--
-- New model, identical to how Google sign-in already works here: the profile
-- row starts with username = NULL and the user claims their handle from
-- /onboarding/username once they have a confirmed session (the middleware
-- onboarding gate — resolveOnboardingGate() — already forces this for any
-- NULL-username profile hitting /dashboard). The handle picked in the signup
-- wizard rides along in raw_user_meta_data->>'username' and pre-fills that
-- form. An abandoned unconfirmed signup now holds nothing, and
-- 074_expire_unconfirmed_signups.sql sweeps the row itself away after 24h.
--
-- The referral row is still created here (keyed on the new user's id, not a
-- username) so settleReferralForPaidEntry has something to settle against;
-- 074's sweep deletes it too if the signup is abandoned.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_referrer_id uuid;
begin
  v_referrer_id := (select id from public.profiles where username = new.raw_user_meta_data->>'ref');

  -- username / display_name deliberately left NULL — claimed after email
  -- confirmation via /onboarding/username (see header).
  insert into public.profiles (id, referred_by)
  values (new.id, v_referrer_id)
  on conflict (id) do nothing;

  if v_referrer_id is not null then
    insert into public.referrals (referrer_id, referred_id, status)
    values (v_referrer_id, new.id, 'pending')
    on conflict (referred_id) do nothing;
  end if;

  return new;
end;
$function$;
