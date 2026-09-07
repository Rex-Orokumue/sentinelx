-- Reactions now send a push, so the seeded default that suppressed them has
-- to change. push.post_reaction was seeded false in migration 062 and every
-- profile still carries exactly that value — it is the seed, not a choice
-- anyone made, and pushToPlayer returns early on false.
--
-- Two halves: the column default for profiles created from here on, and the
-- existing rows.

ALTER TABLE public.profiles
  ALTER COLUMN notification_prefs SET DEFAULT '{
    "whatsapp": {
      "match_reminder": true,
      "result_confirmed": true,
      "prize_credited": true,
      "challenge_completed": false,
      "achievement_unlocked": false,
      "registration_confirmed": true
    },
    "push": {
      "match_reminder": true,
      "result_confirmed": true,
      "achievement_unlocked": true,
      "challenge_completed": true,
      "new_announcement": true,
      "tournament_announced": true,
      "wager_settled": true,
      "referral_converted": true,
      "post_comment": true,
      "post_reaction": true,
      "bracket_released": true,
      "match_assigned": true,
      "prize_credited": true
    },
    "achievement_sharing": {
      "tournament": true,
      "milestone": true,
      "streak": true,
      "social": false,
      "other": false
    }
  }'::jsonb;

-- Only rows still holding the seeded false are flipped. A profile whose value
-- is already true is untouched, so this stays safe to re-run and cannot
-- override a deliberate opt-out made after this ships.
UPDATE public.profiles
SET notification_prefs = jsonb_set(notification_prefs, '{push,post_reaction}', 'true'::jsonb)
WHERE notification_prefs -> 'push' ->> 'post_reaction' = 'false';
