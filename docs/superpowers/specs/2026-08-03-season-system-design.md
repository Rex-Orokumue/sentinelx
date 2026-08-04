# SentinelX Season System — Design Spec

**Date:** 2026-08-03  
**Status:** Approved → ready for implementation  
**Priority:** ASAP — Season 1 starts August 2026

---

## 1. Overview

SentinelX runs annual competitive seasons (August → July). Each season has three tournament tiers:

| Tier | Cadence | Players | Entry | Prize |
|------|---------|---------|-------|-------|
| **Community Club** | Weekly | 32 | Free | None (ranking points only) |
| **SentinelX Masters** | Monthly (last week) | 16 | ₦500 | ₦10,000 (1st), ₦5,000 (2nd) |
| **SentinelX Champions Cup** | Once per season (July) | 16 | Free (invitation) | ₦50,000 (1st), ₦30,000 (2nd), ₦20,000 (3rd) |

**How it works:**  
Players earn ranking points by placing in Community Clubs. Monthly ranking points determine the top 16 invited to Masters. Season cumulative points (clubs + masters) determine the top 16 invited to Champions Cup.

**Season 1:** 1 Aug 2026 – 31 Jul 2027

**August 2026 schedule:**
- Week of Aug 3: Registration/setup — no club (this week)
- Week of Aug 10: Community Club #1
- Week of Aug 17: Community Club #2
- Week of Aug 24: SentinelX Masters #1

---

## 2. Data Model

### 2.1 New tables

```sql
-- Seasons
CREATE TABLE public.seasons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,            -- "Season 1"
  slug        text        NOT NULL UNIQUE,     -- "season-1"
  start_date  date        NOT NULL,            -- 2026-08-01
  end_date    date        NOT NULL,            -- 2027-07-31
  status      text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Season ranking points (one row per player per tournament)
CREATE TABLE public.season_ranking_points (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid        NOT NULL REFERENCES public.seasons(id),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id),
  points        integer     NOT NULL DEFAULT 0,  -- can be negative (no-show penalties)
  placement     integer,                          -- final placement in tournament, NULL for no-show penalty
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, tournament_id)
);

-- Tournament invitations (Masters + Champions Cup)
CREATE TABLE public.tournament_invitations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank_at_invite integer   NOT NULL,   -- their leaderboard rank when invited
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  expires_at    timestamptz NOT NULL,  -- auto-cascade after this
  UNIQUE (tournament_id, player_id)
);
```

RLS on all three tables: users may read rows where `player_id = auth.uid()`; all writes via service-role admin client only.

### 2.2 Extend existing `tournaments` table

```sql
ALTER TABLE public.tournaments
  ADD COLUMN tournament_type text NOT NULL DEFAULT 'open'
    CHECK (tournament_type IN ('community_club', 'masters', 'champions_cup', 'open')),
  ADD COLUMN season_id uuid REFERENCES public.seasons(id),
  ADD COLUMN invitation_only boolean NOT NULL DEFAULT false;
```

- `'open'` = existing tournament behavior, unchanged.
- `season_id = NULL` = not part of any season (historical tournaments).
- `invitation_only = true` = only players with an `accepted` invitation row can register.

### 2.3 Seed Season 1

```sql
INSERT INTO public.seasons (name, slug, start_date, end_date, status)
VALUES ('Season 1', 'season-1', '2026-08-01', '2027-07-31', 'active');
```

---

## 3. Points System

### 3.1 Community Club placements (32 players, single elimination)

| Placement | Points |
|-----------|--------|
| 1st (Champion) | +100 |
| 2nd (Runner-up) | +70 |
| 3rd–4th | +45 |
| 5th–8th | +25 |
| 9th–16th | +10 |
| 17th–32nd | +5 (participation) |

### 3.2 Masters placements (16 players)

| Placement | Points |
|-----------|--------|
| 1st (Champion) | +300 |
| 2nd (Runner-up) | +200 |
| 3rd–4th (Semi-final) | +150 |
| 5th–8th (Quarter-final) | +100 |
| 9th–16th (First round exit) | +50 |

### 3.3 No-show penalty

A no-show in any season tournament (community_club or masters) deducts **-15 ranking points** from the player's `season_ranking_points` for that tournament. Applied in the same sweep that fires the existing **-10 Sentinel Score** penalty — both write in the same transaction.

Monthly and season totals can go negative.

### 3.4 Champions Cup — no additional points

Champions Cup is the season finale. Placement there does not affect the season leaderboard (season is effectively over).

---

## 4. Leaderboard Queries

### Monthly leaderboard (Masters qualification)
```sql
SELECT
  p.id,
  p.username,
  p.avatar_url,
  COALESCE(SUM(srp.points), 0) AS monthly_points
FROM profiles p
LEFT JOIN season_ranking_points srp ON srp.player_id = p.id
  AND srp.season_id = :season_id
  AND srp.tournament_id IN (
    SELECT id FROM tournaments
    WHERE season_id = :season_id
      AND tournament_type = 'community_club'
      AND DATE_TRUNC('month', start_date AT TIME ZONE 'Africa/Lagos')
          = DATE_TRUNC('month', :month_start AT TIME ZONE 'Africa/Lagos')
  )
GROUP BY p.id, p.username, p.avatar_url
ORDER BY monthly_points DESC;
```

### Season cumulative leaderboard (Champions Cup qualification)
```sql
SELECT
  p.id,
  p.username,
  p.avatar_url,
  COALESCE(SUM(srp.points), 0) AS season_points
FROM profiles p
LEFT JOIN season_ranking_points srp ON srp.player_id = p.id
  AND srp.season_id = :season_id
GROUP BY p.id, p.username, p.avatar_url
ORDER BY season_points DESC;
```

### Eligibility filter (Masters + Champions Cup)
Top-16 list is filtered to players with `sentinel_score >= 40`. Players below this threshold are skipped; the next ranked eligible player fills their slot.

---

## 5. Points Pipeline

### 5.1 Award placement points

Extend the post-processing pipeline in `lib/matches/verify-actions.ts` (specifically `recomputeGroupAndMaybeAdvance` and the knockout advancement path). After a tournament reaches a terminal state (champion determined):

New function: `awardSeasonPoints(tournamentId: string)`
- Called once when `tournament.status` transitions to `'completed'`
- Reads final placements from `tournament_registrations` (derive from bracket: who reached which round)
- Looks up `tournament.tournament_type` and `tournament.season_id`
- If `season_id` is null or `tournament_type = 'open'`: no-op
- Otherwise: upserts one `season_ranking_points` row per player using the points table above
- Idempotent: `ON CONFLICT (season_id, player_id, tournament_id) DO UPDATE SET points = EXCLUDED.points`

### 5.2 Award no-show penalty points

Extend `lib/matches/noshow-actions.ts` (the no-show sweep, `resolvePendingNoShowMatches`). When a match is flagged as no-show and the match belongs to a season tournament:

- For each no-show player: upsert a `season_ranking_points` row with `points = -15`, `placement = NULL`, `tournament_id = match.tournament_id`.
- If a row already exists for that `(season_id, player_id, tournament_id)` (they earned placement points): the -15 writes a **separate** row is not possible due to UNIQUE constraint. Instead: the no-show penalty is stored as a separate entry keyed by `(season_id, player_id, tournament_id || '_noshow')` — OR — simpler: use a separate `season_noshow_penalties` table:

```sql
CREATE TABLE public.season_noshow_penalties (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid        NOT NULL REFERENCES public.seasons(id),
  player_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id      uuid        NOT NULL REFERENCES public.matches(id),
  points        integer     NOT NULL DEFAULT -15,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, match_id)
);
```

Both `season_ranking_points` and `season_noshow_penalties` are summed for leaderboard queries.

Updated leaderboard query (adds penalty sum):
```sql
COALESCE(SUM(srp.points), 0) + COALESCE((
  SELECT SUM(snp.points)
  FROM season_noshow_penalties snp
  WHERE snp.player_id = p.id AND snp.season_id = :season_id
), 0) AS total_points
```

---

## 6. Invitation Flow (Masters + Champions Cup)

### 6.1 Triggering invitations

Admin goes to the Masters tournament admin page → clicks **"Send Invitations"** button. System:

1. Runs the monthly leaderboard query (for Masters) or season leaderboard query (for Champions Cup)
2. Filters to `sentinel_score >= 40` eligible players
3. Takes the top 16
4. Creates 16 `tournament_invitations` rows with `status = 'pending'`, `expires_at = now() + interval '48 hours'`
5. Sends each invited player:
   - In-app notification: `masters_invitation` type (new `NotificationType`)
   - WhatsApp notification via existing `notify()` (new template `{ type: 'masters_invitation'; tournamentName: string; prize: string; deadline: string; acceptUrl: string }`)

### 6.2 Player accepts

Player sees invitation in their dashboard notification centre or `/dashboard` page — a banner:

> **You've been invited to SentinelX Masters!**  
> You ranked #3 this month. Accept by [date] to secure your spot.  
> Entry fee: ₦500  
> [Accept & Pay] [Decline]

**[Accept & Pay]** → runs `acceptMastersInvitation(invitationId)` server action:
1. Sets `tournament_invitations.status = 'accepted'`, `responded_at = now()`
2. Creates a `tournament_registrations` row with `payment_status = 'pending'`
3. Redirects player to Paystack checkout for ₦500
4. On Paystack webhook success: sets `payment_status = 'paid'`
5. If payment not completed within 24 hours: row stays `pending`, slot is treated as unfilled

**[Decline]** → runs `declineMastersInvitation(invitationId)`:
1. Sets `status = 'declined'`, `responded_at = now()`
2. Triggers cascade: invites the next ranked eligible player not yet invited

### 6.3 Cascade on expiry

A cron job (daily, same pattern as the no-show sweep) checks for `tournament_invitations` where `status = 'pending'` AND `expires_at < now()`. For each: sets `status = 'expired'`, triggers cascade to next player.

Also: admin can manually trigger cascade from the Masters admin page ("Check & Cascade Invitations" button) — useful right after the 48-hour window closes without waiting for the next cron tick.

### 6.4 Slot fill logic

Cascade continues until either 16 slots are `accepted`+paid, or the leaderboard is exhausted (rare edge case — admin handles manually).

Champions Cup: same flow, no ₦500 payment step, `payment_status = 'paid'` is set automatically on acceptance.

---

## 7. New Notification Types

In `lib/notifications/templates.ts`, add:

```ts
| { type: 'masters_invitation'; tournamentName: string; rank: number; deadline: string; entryFee: string }
| { type: 'champions_cup_invitation'; tournamentName: string; rank: number }
| { type: 'invitation_accepted'; tournamentName: string; playerName: string }  // for admin
| { type: 'invitation_expired_cascade'; tournamentName: string; newRank: number }  // for newly-cascaded player
```

In `lib/notifications/keys.ts`, add:
```ts
export const mastersInviteKey = (tournamentId: string, playerId: string) =>
  `masters_invite:${tournamentId}:${playerId}`
```

---

## 8. Season Page (`app/seasons/[slug]/page.tsx`)

A new public page. Accessible without login.

### URL: `/seasons/season-1`

### Layout:

**Hero section:**
- "SEASON 1" label
- "AUG 2026 – JUL 2027"
- Current week number + days until next event
- Stat pills: X Community Clubs completed · X Masters completed · X Players competing

**Season Schedule (monthly accordion or tab)**

Each month tab (August, September... July):
```
AUGUST 2026
─────────────────────────────────────────────────
📅 Aug 10   Community Club #1    [Completed / Register / Upcoming]
📅 Aug 17   Community Club #2    [Completed / Register / Upcoming]
👑 Aug 24   SentinelX Masters    [Completed / Invite Only / Upcoming]
─────────────────────────────────────────────────
```
Month header shows: "Top ranked player this month: [username] — [X pts]"

**Season Leaderboard** (below schedule):
- Table: # · Player · Community Clubs Played · Masters Qualified · Season Points
- Shows top 50; paginated
- Current user's row highlighted if logged in
- "Qualify for Champions Cup — top 16 at season end earn an invitation"

**Champions Cup spotlight** (bottom of page):
- "THE ULTIMATE PRIZE"
- Date: July 2027
- Prize breakdown
- "1st ₦50,000 · 2nd ₦30,000 · 3rd ₦20,000"
- "Top 16 of the season earn an invitation"

---

## 9. Admin Pages

### 9.1 Create season tournament

On `app/admin/tournaments/create/page.tsx`, add:
- **Tournament Type** dropdown: Open / Community Club / SentinelX Masters / SentinelX Champions Cup
- **Season** dropdown: populated from `seasons` table (only shown if type ≠ Open)
- **Invitation Only** toggle: auto-enabled and non-editable for Masters and Champions Cup

### 9.2 Masters/Champions Cup admin page

On `app/admin/tournaments/[id]/page.tsx`, when `tournament_type IN ('masters', 'champions_cup')`, show an additional panel:

**"Invitations" panel:**
- Table: Rank · Player · Status (Pending / Accepted / Declined / Expired) · Invited At · Expires At
- Buttons: [Send Invitations] · [Check & Cascade Now] · [Manually Add Player]
- Manually Add Player: bypasses leaderboard, admin picks any profile (for edge cases)

---

## 10. Invitation Dashboard Widget (`app/dashboard/page.tsx`)

If logged-in player has a `pending` invitation with `expires_at > now()`:

Show a prominent banner at the top of their dashboard:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🏆 You've been invited to SentinelX Masters!                    │
│ You ranked #5 in August. Entry fee: ₦500.                       │
│ Deadline: 25 Aug 2026 at 11:59 PM WAT                          │
│                          [Accept & Pay]  [Decline]              │
└─────────────────────────────────────────────────────────────────┘
```

Dismissing without responding does nothing — it reappears on next visit until expiry.

---

## 11. Navigation

Add **"Seasons"** link to the nav between "Leaderboards" and "Store":

`Home · Tournaments · Games · Leaderboards · **Seasons** · Store · Community · About Us`

On mobile drawer: same order.

---

## 12. Out of Scope

- Automated Paystack reminder if invited player hasn't paid within 12 hours (Phase 2)
- Season-level stats on public player profiles (Phase 2)
- Historical season archives (Season 1 is first — nothing to archive yet)
- Champions Cup administration (July 2027 — build in ~11 months)
- Visual overhaul of the Season page to match Phase 1 design (pending Phase 1 completion)

---

## 13. Testing

- `awardSeasonPoints`: unit test each placement → expected points, and that `tournament_type = 'open'` returns early
- `season_noshow_penalties`: integration test that a no-show in a community_club match writes -15 and the Sentinel Score write is in the same transaction
- `leaderboard queries`: test eligibility filter correctly excludes `sentinel_score < 40` players
- `acceptMastersInvitation` / `declineMastersInvitation`: integration tests covering payment-pending state and cascade trigger
- Cascade cron: stage an expired invitation, run cron, confirm `status = 'expired'` and next player receives invitation row
- Season page: snapshot test showing correct tournament statuses (completed/upcoming) per month
