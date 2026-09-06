# Account Deletion — Design

**Date:** 2026-09-06
**Status:** Draft for review
**Supersedes:** the hard-delete implementation in `lib/settings/account.ts`

---

## 1. Problem

Settings → Account offers a "Delete Account" button. It calls
`auth.admin.deleteUser()`, which cascades to `profiles` via
`profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`.

Of the 57 foreign keys pointing at `profiles`, **34 are `NO ACTION`**. In
Postgres that aborts the delete when referencing rows exist, so the whole
transaction fails and the user sees the generic *"Could not delete your
account. Please try again or contact support."* Retrying never helps.

Measured against production on 2026-09-06:

| | |
|---|---|
| Total users | 102 |
| Have `sx_score_events` rows | 58 |
| Have `tournament_registrations` | 69 |
| Have `notifications` | 64 |
| **Deletion fails for** | **82 of 102 (80%)** |

The 20 who succeed are accounts that signed up and did nothing. Because
every SX Score change writes an `sx_score_events` row (CLAUDE.md rule 6),
that blocked set only grows.

Privacy Policy §6 commits to honouring data-subject rights within 30 days,
so a silently-failing delete button is a compliance problem as well as a UX
one.

---

## 2. Approach: anonymise in place, do not delete the row

The naive fix — flip 34 constraints to `CASCADE` — is actively harmful. It
would delete players out of live brackets, rewrite completed tournament
history, and destroy Paystack-referenced financial records needed for
reconciliation and tax. Erasure rights do not override those retention
obligations.

**The profile row survives as a tombstone.** Its personal data is erased,
its identity is replaced, and every foreign key continues to point at it.

This has a large consequence: **no FK constraint needs to change.** The
constraint problem in §1 exists only because the current design deletes the
row. Once we stop deleting it, all 57 keys stay valid as they are.

One schema change makes this possible: **drop the FK from `profiles.id` to
`auth.users(id)`**. Today that cascade is what destroys the profile when the
auth user goes. Without it, we can delete the auth user — genuinely revoking
sign-in — while the tombstone profile remains. `profiles.id` stays a plain
`uuid` primary key, and `handle_new_user()` keeps populating it with the auth
user's id on signup exactly as it does now.

### Retain / anonymise / delete

The rule: **delete what is purely private to the user and referenced by
nobody; retain what a competition record, a financial ledger, or another
user depends on.**

**Deleted outright** — private, unreferenced:
`fcm_tokens`, `phone_verifications`, `player_kyc`, `game_interest`,
`player_challenge_progress`, `player_store_items`, `notifications`,
`player_notifications`, `tournament_invitations`, `user_roles`, `xp_events`,
`friends` (a mutual relationship ends when one side leaves).

**Retained, pointing at the tombstone** — competition, financial, social:
`matches`, `match_results`, `match_check_ins`, `sx_score_events`,
`opponent_ratings`, `group_memberships`, `season_ranking_points`,
`season_noshow_penalties`, `player_achievements`, `tournament_registrations`,
`tournament_fee_waivers`, `friendly_matches`, `friendly_match_results`,
`wallets`, `wallet_transactions`, `wallet_deposits`, `withdrawal_requests`,
`sx_coins`, `sx_coin_transactions`, `match_wagers`, `marketplace_listings`,
`marketplace_orders`, `buy_requests`, `referrals`, `admin_flags`,
`best_play_votes`, `chat_messages`, `community_posts`, `post_comments`,
`post_reactions`, `profiles.referred_by`, `tv_videos.created_by`,
`homepage_banners.created_by`.

`admin_flags` is retained deliberately: a conduct or cheating record must
outlive the account, or deletion becomes a way to launder a ban.

Community posts and comments are retained under the tombstone so threads
stay coherent — consistent with keeping match results visible.

---

## 3. Schema changes

```sql
-- 1. Let the profile outlive its auth user.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

-- 2. Mark tombstones.
ALTER TABLE public.profiles ADD COLUMN deleted_at timestamptz;
CREATE INDEX profiles_deleted_at_idx ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 3. Retire usernames permanently, unlinked to any person.
CREATE TABLE public.retired_usernames (
  username    text PRIMARY KEY,
  retired_at  timestamptz NOT NULL DEFAULT now()
);
```

`retired_usernames` holds **only the string**. It carries no user id and no
foreign key, so it is not personal data once the profile is anonymised —
which is what lets us block reuse permanently *and* honour erasure. Signup
and username-change availability checks must consult it alongside
`profiles.username`.

RLS: `retired_usernames` is readable by nobody through PostgREST; the
availability check runs server-side via the service-role client, matching how
username collisions are handled today.

---

## 4. Deletion flow

`deleteAccount()` in `lib/settings/account.ts` is rewritten as:

**Step 1 — Guards.** Refuse with a specific reason if any hold:

| Blocker | Condition |
|---|---|
| Wallet balance | `wallets.balance > 0` |
| Pending withdrawal | `withdrawal_requests.status = 'pending'` |
| Open escrow order | `marketplace_orders.status IN ('initiated','payment_held')` as buyer or seller |
| Live listing | `marketplace_listings.status = 'active'` |
| Active tournament | `tournament_registrations.status = 'active'` joined to `tournaments.status IN ('registration_open','registration_closed','active')` |
| Unfinished match | `matches.status IN ('scheduled','live','disputed')` as player A or B |
| Unfinished friendly | `friendly_matches.status IN ('pending','awaiting_payment','active','awaiting_admin_confirmation','disputed')` as challenger or opponent |

SX Coins are **not** a blocker — they are non-cashable, so they are forfeited.

Guards return a structured list, not a single string, so the UI can render
each blocker with its own remedy.

**Step 2 — Anonymise** (single transaction):

```
username           → 'deleted_' || substr(id::text, 1, 8)
display_name       → 'Deleted player'
avatar_url, country, phone, whatsapp_number, bio → NULL
notification_prefs → '{}'::jsonb
last_login_date, login_streak → NULL / 0
deleted_at         → now()
```

Competitive stats (`sx_score`, `wins`, `losses`, `total_titles`, `xp`,
`membership_tier`, `sentinel_tier`) are **kept** — they are the substance of
the retained match history and the leaderboards it feeds.

**Step 3 — Retire the username.** Insert the original into
`retired_usernames`. `ON CONFLICT DO NOTHING`.

**Step 4 — Delete the private tables** listed in §2.

**Step 5 — Revoke sign-in.** `auth.admin.deleteUser(user.id)`. With the FK
dropped in §3, the tombstone profile is unaffected.

**Step 6 — Sign out** and redirect to `/`, as the current UI already does.

Steps 2–4 run in one transaction via a `SECURITY DEFINER` RPC so a partial
anonymisation cannot occur. Step 5 is a separate Auth API call and cannot
join that transaction: if it fails, the profile is already anonymised and
the user is effectively gone, so the RPC records `deleted_at` and the error
is logged for admin follow-up rather than rolled back.

---

## 5. Display

Every surface rendering a player identity must show "Deleted player" and
must not link to a profile that no longer exists.

New helper, `lib/players/display.ts`:

```ts
export const DELETED_PLAYER_NAME = 'Deleted player'
export function isDeleted(p: { deleted_at: string | null }): boolean
export function displayNameFor(p: ProfileRef): string
export function profileHrefFor(p: ProfileRef): string | null  // null when deleted
```

Queries that render names must select `deleted_at`. Affected surfaces:
brackets and match cards, Match Centre, rankings and leaderboards, Hall of
Fame, community posts and comments, friendly matches, the Exchange listing
seller line, admin tables, and the OG image generator in
`lib/og/match-card.tsx`.

`/players/[username]` for a tombstone returns `notFound()` — the handle is
retired, so no public profile page exists for it.

Rankings and Hall of Fame keep tombstones in place: removing them would
renumber historical standings.

---

## 6. Testing

Pure logic, unit-tested in the existing vitest style:

- `lib/settings/deletion-guards.ts` — each blocker fires on its own status
  values and stays silent otherwise; multiple blockers accumulate.
- `lib/players/display.ts` — deleted profiles render the tombstone name and
  yield a `null` href; live profiles are untouched.
- Username availability rejects a retired handle, and rejects it
  case-insensitively if the existing check is case-insensitive.

Integration, against a branch database:

- A user with rows in every retained table deletes successfully — this is
  the case that fails today for 82 of 102 users.
- Their `matches`, `tournament_registrations`, `sx_score_events`,
  `wallet_deposits` and `marketplace_orders` rows still exist afterwards.
- Their `fcm_tokens`, `phone_verifications` and `player_kyc` rows are gone.
- The original username cannot be claimed by a new signup.
- The auth user can no longer sign in.

---

## 7. Out of scope

- **Generated usernames at signup** — a separate spec. It depends on this
  one only through the availability check, which must also consult
  `retired_usernames`.
- **Admin-initiated deletion / bans** — `admin_flags` already covers
  conduct; a ban is not a deletion.
- **Data export** ("download my data") — a distinct data-rights feature.
- **Reversal.** There is no undo. The 30-day grace period some platforms
  offer is deliberately not proposed here; if you want it, it changes step 5
  from "delete the auth user" to "ban the auth user until", and is worth its
  own decision.
