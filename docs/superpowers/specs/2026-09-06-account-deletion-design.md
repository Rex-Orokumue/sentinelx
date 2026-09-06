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
one. A 15-day grace period sits comfortably inside that window.

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
auth user goes. Without it, the auth user can be deleted at execution —
genuinely revoking sign-in — while the tombstone profile remains.
`profiles.id` stays a plain `uuid` primary key, and `handle_new_user()`
keeps populating it with the auth user's id on signup exactly as it does
now.

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

Community posts and comments are retained under the tombstone so threads
stay coherent — consistent with keeping match results visible.

---

## 3. Lifecycle

```
  Settings → Account
       │
       ├──────────────── "Delete now" ────────────────┐
       │                 (type username)              │
       ▼                                              │
  "Delete my account"                                 │
       │                                              │
       ▼                                              │
  ┌─────────────┐   guards fail                       │
  │  Requested  │◄───────────────  refused (§5)       │
  └──────┬──────┘                                     │
         │  deletion_requested_at = now()             │
         │  email + in-app banner                     │
         ▼                                            │
  ┌─────────────────────────────┐                     │
  │  Grace — 15 days            │  user can sign in   │
  │  account restricted (§6)    │  banner every page  │
  │  reminder email at day 12   │  Cancel throughout  │
  └──────┬───────────────┬──────┘                     │
         │               │  Cancel deletion           │
  day 15 │               ▼                            │
         │        ┌─────────────┐                     │
         │        │   Active    │  restrictions lift  │
         │        └─────────────┘                     │
         ▼                                            │
  ┌─────────────┐◄──────────────────────────────────-─┘
  │  Executed   │  anonymised · username retired · auth user deleted
  └─────────────┘  irreversible
```

**The user can sign in during the grace period.** That is how they cancel,
and it is what makes the banner in §8 reach them. Locking them out
immediately would make a link in a single email the only route back, which
fails exactly the person who deletes in frustration and reconsiders a week
later.

**"Delete now"** skips the grace period and runs §9 synchronously. It is a
deliberate escape hatch for someone who wants out immediately, and it
removes the safety net the grace period provides — so it is gated on typing
the **exact username**, not `DELETE`. That is a higher bar, works
identically for password and Google accounts, and the final email still
sends immediately so the account's real owner learns of it. The §5 guards
apply unchanged.

---

## 4. Schema changes

```sql
-- 1. Let the profile outlive its auth user.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

-- 2. Grace-period state and the eventual tombstone marker.
ALTER TABLE public.profiles
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deleted_at            timestamptz;

CREATE INDEX profiles_deletion_pending_idx ON public.profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX profiles_deleted_at_idx ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 3. Retire usernames permanently, unlinked to any person.
CREATE TABLE public.retired_usernames (
  username    text PRIMARY KEY,
  retired_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Ban-evasion blocklist. Hashes only, for cheat-flagged accounts (§7).
CREATE TABLE public.banned_identifiers (
  hash        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('email','phone')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

`deletion_requested_at` and `deleted_at` are distinct states, not one field
reused: requested-and-not-deleted means *in grace*; `deleted_at` set means
*tombstone*. Cancelling clears `deletion_requested_at`.

`retired_usernames` holds **only the string** — no user id, no foreign key —
so it is not personal data once the profile is anonymised. That is what lets
us block reuse permanently *and* honour erasure. Signup and username-change
availability checks must consult it alongside `profiles.username`. A
username is retired at **execution**, not at request, so a cancelled
deletion leaves the handle untouched.

Neither new table is readable through PostgREST; both are checked
server-side via the service-role client, matching how username collisions
are handled today.

---

## 5. Guards

Checked at **request** time, at **execution** as a safety net, and on
**"Delete now"**. Deletion is refused if any hold:

| Blocker | Condition |
|---|---|
| Wallet balance | `wallets.balance > 0` |
| Pending withdrawal | `withdrawal_requests.status = 'pending'` |
| Open escrow order | `marketplace_orders.status IN ('initiated','payment_held')` as buyer or seller |
| Live listing | `marketplace_listings.status = 'active'` |
| Active tournament | `tournament_registrations.status = 'active'` joined to `tournaments.status IN ('registration_open','registration_closed','active')` |
| Unfinished match | `matches.status IN ('scheduled','live','disputed')` as player A or B |
| Unfinished friendly | `friendly_matches.status IN ('pending','awaiting_payment','active','awaiting_admin_confirmation','disputed')` as challenger or opponent |

SX Coins are **not** a blocker — they are non-cashable, so they are
forfeited.

Guards return a structured list, not a single string, so the UI renders each
blocker with its own remedy.

**If the execution-time re-check fails**, the deletion is *paused*, not
cancelled and not silently dropped: the user keeps their pending state, is
emailed to say why, and the run is flagged for admin. Given §6 this should
be rare — a referral credit landing mid-grace is the realistic case.

---

## 6. Restrictions during grace

The account cannot take on **new obligations** while pending deletion. This
is what keeps the day-15 execution safe, and it stops the account competing
for a prize it is about to abandon.

Blocked, with an explanatory message linking to Cancel:

- Registering for a tournament, or joining a waitlist
- Creating an Exchange listing or a buy request; purchasing
- Issuing or accepting a friendly challenge
- Wallet deposits and withdrawal requests
- Placing a wager

Unaffected: browsing, viewing history, community reading and posting,
settings, and cancelling the deletion.

Server-side enforcement belongs next to the existing checks — the
`checkCanRegister` guard in `lib/tournaments/guard.ts` is the model — so a
restricted action fails in the Server Action, not merely in the UI.

---

## 7. Email reuse and ban evasion

**The email address is released and can be used to register again.** At
execution the row in `auth.users` is deleted, taking the email with it. A
new signup with that address creates a genuinely new account — new UUID, SX
Score back to 700, no history, no link to the tombstone. Nothing is
restored.

This is deliberately the opposite of the username policy, because the two
are not alike:

| | Username | Email |
|---|---|---|
| Visible to others | Yes — URLs, brackets, referral links | Never |
| Third parties rely on it | Yes | No |
| Blocking reuse protects | Other users, from impersonation | Nobody |
| Retaining the string is | Not personal data once unlinked | **Unambiguously personal data** |

A general `retired_emails` blocklist would be a list of real people's email
addresses — exactly what erasure promises to remove — and would bar someone
from ever returning because they once exercised a data right.

**One exception: accounts flagged for cheating.** Retaining `admin_flags` on
the tombstone does not by itself prevent ban evasion, since a new account
built from the same email has no link to that tombstone. So at execution,
**if and only if** the account has an `admin_flags` row with
`severity = 'cheat'`, a one-way hash of its email and phone is written to
`banned_identifiers`:

```
sha256(lower(trim(value)) || pepper)
```

The pepper is a server-side secret from env (`DELETION_HASH_PEPPER`),
present so the table cannot be reversed by hashing a list of common
addresses. No plaintext, no user id, no foreign key. Signup hashes the
incoming email and rejects a match with the same generic "couldn't create
that account" response used elsewhere, so the table's contents are not
probeable.

`severity = 'conduct'` flags (−50 SX Score) do **not** trigger this — a
minor conduct flag should not bar someone for life.

**This retention must be disclosed** in the Privacy Policy (all three
locales) alongside the existing §6 data-rights text: what is kept, that it
is a one-way hash, that it applies only to accounts removed for cheating,
and that it is retained indefinitely to enforce the sanction.

### Admin recovery tools

Both permanent decisions in this design — a retired username and a banned
identifier — need a way back, because both can be made in error and neither
is reversible from the user's side. One admin screen,
`/admin/account-recovery`, carries both. Admin role only, not moderator:
these are identity and sanction decisions, and moderators already have no
financial or ban powers.

**Release a retired username.** Takes a username, deletes its
`retired_usernames` row, and the handle becomes claimable again. The
realistic case is the one this design most likely generates support mail
for: someone deletes as `sniperking`, returns a month later with the same
email — which §7 allows — and finds they cannot have their name back. The
screen warns that releasing it lets *anyone* claim it, not just the previous
owner, since there is no longer any record of who that was.

**Clear a banned identifier.** Takes an email or phone, hashes it with the
same pepper, and deletes the matching row. The input is the plaintext value
because the stored hash cannot be reversed. It reports whether a row
matched, which is the only way to confirm the entry existed.

Both actions write to the existing admin audit trail.

---

## 8. Communication

"Clearly communicated" is the requirement, so the state is unmissable rather
than buried in settings.

**At request — the confirm dialog states the date, not a duration:**

> Your account will be permanently deleted on **21 September 2026**.
>
> Until then you can sign in and cancel at any time. Your match history and
> tournament results will remain visible under "Deleted player". Your
> username `sniperking` will be retired and cannot be used again. The email
> address on the account can be used to register again later.
>
> Type DELETE to confirm.

**"Delete now" — a separate, stronger confirmation:**

> This skips the 15-day grace period. Your account is deleted immediately.
> There is no cancellation and no undo.
>
> Type your username `sniperking` to confirm.

**Immediately after a request:** an email confirming the scheduled date with
a direct cancel link, and an in-app inbox notification.

**Throughout the grace period:** a persistent banner on every page while
signed in — not dismissible, since dismissing the only warning about
impending deletion defeats it:

> ⚠ Your account is scheduled for deletion on 21 September — 12 days left.
> **Cancel deletion**

**Day 12 (3 days remaining):** reminder email.

**At execution:** a final email to the address *before* it is scrubbed,
confirming the deletion is complete and irreversible. Sent for "Delete now"
too.

**On cancel:** confirmation email, banner clears, restrictions lift.

All copy is new UI text and needs `en` / `fr` / `pcm` entries.

Email requires a transactional sender — the app has no email path of its own
(`lib/notifications/` covers WhatsApp via Termii, push, and the in-app
inbox; auth mail goes through Supabase SMTP). Resend is verified for
`sentinelxesports.com.ng`, so this adds a small `lib/email/send.ts` wrapper
over the Resend API, following the no-op-when-unconfigured pattern
`TERMII_API_KEY` already uses.

---

## 9. Execution

Two entry points, one code path:

- **Scheduled** — `app/api/cron/execute-account-deletions/route.ts`,
  following the `CRON_SECRET` bearer-token pattern in
  `app/api/cron/fixture-reminders/route.ts`. Selects profiles where
  `deletion_requested_at <= now() - interval '15 days'` and `deleted_at IS
  NULL`.
- **Immediate** — the "Delete now" Server Action, after username
  confirmation.

Per account:

**Step 1 — Run guards** (§5). Pause and notify on failure.

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
`retired_usernames`, `ON CONFLICT DO NOTHING`.

**Step 4 — If cheat-flagged**, write the identifier hashes (§7).

**Step 5 — Delete the private tables** listed in §2.

**Step 6 — Send the final email**, before the address is gone.

**Step 7 — Revoke sign-in.** `auth.admin.deleteUser(user.id)`. With the FK
dropped in §4, the tombstone profile is unaffected.

Steps 2–5 run in one transaction via a `SECURITY DEFINER` RPC so a partial
anonymisation cannot occur. Step 7 is a separate Auth API call that cannot
join that transaction: if it fails, the profile is already anonymised and
the user is effectively gone, so `deleted_at` stands and the error is logged
for admin follow-up rather than rolled back.

---

## 10. Display

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

Accounts **in grace are displayed normally** — nothing is public until
execution.

`/players/[username]` for a tombstone returns `notFound()` — the handle is
retired, so no public profile page exists for it.

Rankings and Hall of Fame keep tombstones in place: removing them would
renumber historical standings.

---

## 11. Testing

Pure logic, unit-tested in the existing vitest style:

- `lib/settings/deletion-guards.ts` — each blocker fires on its own status
  values and stays silent otherwise; multiple blockers accumulate.
- Grace-window arithmetic — day 14 does not execute, day 15 does; mirrors
  the boundary style of `lib/notifications/window.test.ts`.
- Restriction predicate — pending accounts are blocked from each action in
  §6 and permitted for the rest.
- `lib/players/display.ts` — deleted profiles render the tombstone name and
  yield a `null` href; in-grace and live profiles are untouched.
- Identifier hashing is stable, case- and whitespace-insensitive, and
  differs without the pepper.
- Username availability rejects a retired handle, case-insensitively if the
  existing check is.

Integration, against a branch database:

- A user with rows in every retained table executes successfully — the case
  that fails today for 82 of 102 users.
- Their `matches`, `tournament_registrations`, `sx_score_events`,
  `wallet_deposits` and `marketplace_orders` rows still exist afterwards.
- Their `fcm_tokens`, `phone_verifications` and `player_kyc` rows are gone.
- Cancelling mid-grace restores full function and leaves the username
  claimable by its owner.
- The original username cannot be claimed by a new signup after execution.
- **The original email can** be used to register a new account.
- A cheat-flagged account's email cannot; a conduct-flagged one's can.
- "Delete now" reaches the same end state without waiting.
- The auth user can no longer sign in after execution.
- Releasing a retired username makes it claimable again; clearing a banned
  identifier lets that email register. Both are admin-only — a moderator
  session is refused.

---

## 12. Out of scope

- **Generated usernames at signup** — a separate spec. It depends on this
  one only through the availability check, which must also consult
  `retired_usernames`.
- **Admin-initiated deletion / bans** — `admin_flags` already covers
  conduct; a ban is not a deletion.
- **Data export** ("download my data") — a distinct data-rights feature.
- **Undo after execution.** The grace period is the reversal window; once
  step 7 runs there is no recovery, and "Delete now" waives it knowingly.
