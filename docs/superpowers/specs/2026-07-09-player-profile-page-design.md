# Player Profile Page (#10b) — Design Spec

**Date:** 2026-07-09
**Status:** Approved design → ready for implementation plan
**Depends on:** #10a (stats & Sentinel Score engine — the data this page displays).

---

## 1. Goal

Build the public player profile at `/players/[username]` — identity, Sentinel Score + tier, leaderboard rank, full stats, achievements (titles), and recent match history — over the aggregates and score that #10a populates. This is the destination the nav rework's "My Profile" link was built to reach.

## 2. Route & data loading

`app/(public)/players/[username]/page.tsx` — a server component. Public: `profiles` has `profiles_public_read` RLS, so no auth needed.

- **Lookup:** exact match on `profiles.username`. Unknown username → `notFound()` (Next 404).
- Four reads (the profile fetch first; the rest can run together once we have the id):

1. **Profile** — the `profiles` row by username: `id, username, display_name, avatar_url, country, created_at, sentinel_score, sentinel_tier, total_matches, wins, losses, goals_scored, goals_conceded, total_titles`.
2. **Rank** — a single Postgres function call (see §3). `NULL` → "Unranked".
3. **Recent matches** — up to 10 `completed` matches where the player is A or B, `completed_at desc`, joined to both participants' names and the tournament (`title, slug`).
4. **Achievements (titles)** — completed finals the player was in (`round='final'`, `status='completed'`, player is A or B), joined to tournament `title, slug` and game `name`. Each is kept only if `getChampion([...])` (from `lib/tournaments/bracket`) resolves to this player's id — reusing the one winner rule, never reimplementing it.

## 3. Rank — leaderboard-consistent, single query

Rank must equal the player's actual position on `/rankings`, whose order is **wins → win rate → titles → goal difference** (`rankPlayers` in `lib/rankings/leaderboard.ts`). Implemented as a Postgres function so it stays one indexed query with no rows loaded into app memory.

**Migration `009_player_rank.sql`:**

```sql
-- Rank of a player among eligible players (total_matches >= 1), matching the
-- /rankings order: wins → win rate → titles → goal difference. Returns NULL for
-- an unranked player (0 matches) or unknown username.
-- NOTE: this tiebreak MUST mirror rankPlayers() in lib/rankings/leaderboard.ts.
CREATE OR REPLACE FUNCTION public.player_rank(uname text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT wins, total_matches, total_titles, goals_scored, goals_conceded
    FROM public.profiles
    WHERE username = uname
  )
  SELECT CASE
    WHEN p.total_matches < 1 THEN NULL
    ELSE (
      SELECT count(*) + 1
      FROM public.profiles o, p
      WHERE o.total_matches >= 1
        AND (
          o.wins > p.wins
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches > p.wins::float / p.total_matches)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles > p.total_titles)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles = p.total_titles
              AND (o.goals_scored - o.goals_conceded) > (p.goals_scored - p.goals_conceded))
        )
    )
  END
  FROM p;
$$;
```

`SECURITY INVOKER` (default) + `STABLE`; reads only `profiles` (public-read), so it's callable by anon. Applied to the live project via MCP; then **regenerate `lib/supabase/types.ts`** so `supabase.rpc('player_rank', { uname })` is typed. The page calls it and treats `null` as "Unranked".

## 4. Page sections (components in `components/player/`)

- **`ProfileHeader`** — `Avatar` (image or initials), display name, `@username`, country, **Sentinel Score** shown as a prominent `NN/100` with `TierBadge`, a **Rank badge** ("Ranked #3" or "Unranked"), and member-since (`formatMonthYear(created_at)` — WAT, from `lib/format`).
- **`ProfileStats`** — responsive stat grid: Matches, Wins, Losses, **Win rate**, Goals For, Goals Against, **Goal diff** (signed), Titles.
- **`ProfileAchievements`** — trophy cards for tournaments won (tournament title, game, date; links to `/tournaments/[slug]`). `EmptyState` ("No titles yet") when none.
- **`ProfileMatchHistory`** — last-10 rows: `vs {opponent}`, score, a **W / L / D** badge, tournament title, date, each linking to `/matches/[id]`. `EmptyState` when none.

Reuses `Avatar`, `TierBadge`, `EmptyState`. Mobile-first (375px up).

## 5. SEO (required by CLAUDE.md for player pages)

- **`generateMetadata`** — title `"{displayName} (@username) — SentinelX Esports"`; description built from headline stats (e.g. "Sentinel Score 88 · 12W–3L · 2 titles on Sentinel X"); OpenGraph tags for WhatsApp previews. Unknown username → generic "Player not found" title.
- **JSON-LD** — an inline `<script type="application/ld+json">` with a schema.org `ProfilePage`/`Person` (name, alternateName = username). Kept in a small helper so the shape is one place.

## 6. Pure helpers + testing

`lib/players/profile.ts` — the testable logic, colocated `profile.test.ts` (Vitest):

- `winPercent(wins: number, total: number): string` — `"67%"`; `total <= 0` → `"0%"`.
- `goalDifference(scored: number, conceded: number): number` — `scored - conceded` (component adds the +/− sign).
- `matchOutcome(playerId: string, m: { player_a_id, player_b_id, score_a, score_b }): 'win' | 'loss' | 'draw'` — from the player's perspective.

Tests cover each incl. the 0-match/0-total edge and player-as-A vs player-as-B. The page loader stays thin; visual verification by build.

## 7. Wiring the profile into the app

- **`AccountMenu` "My Profile"** → `session.username ? '/players/${session.username}' : '/dashboard'` (fills the seam left in the nav rework; falls back to `/dashboard` if a logged-in user has no username).
- **Leaderboard names link to profiles** — in `components/rankings/LeaderboardTable.tsx`, wrap each player's name in a `Link` to `/players/[username]` (the row data already carries `username`). Makes profiles discoverable where players look for themselves.

## 8. Scope boundaries

**In:** the profile page (4 sections), leaderboard-consistent rank (+ migration + types regen), SEO/JSON-LD, pure helpers + tests, `AccountMenu` wiring, leaderboard name links.
**Out (seams left):** Sentinel Score history timeline (v2 — needs accumulated events); own-profile edit affordance (needs a profile-editing feature); per-game stat splits (aggregates are global until multi-game, v4.0); linking player names on match/bracket pages to profiles (later follow-up).
