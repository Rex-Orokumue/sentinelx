# Admin gap fixes (#15–#20) — Design

Six gaps Samuel flagged after reviewing the live platform. Each is scoped independently
below but they ship together as one v3.5 release. This spec supersedes the ROADMAP.md
v4.0 entry numbering: the existing "#15 Multi-game support + team leagues" item is
renumbered to **#21**, freeing #15–#20 for this work.

Status of the codebase this spec builds on: v1.0–v3.0 complete (tournaments, brackets,
matches, Sentinel Score, TV, WhatsApp share, Gaming Exchange, KYC + withdrawals all
shipped). Migrations run through `014_kyc_withdrawals.sql`.

---

## #15 — Tournament registration fields

**Problem:** Registration only captures payment. Samuel has no way to verify who's
actually behind an entry (real name, contact, which club/team, in-game ID) before a
tournament starts.

**Schema** — new migration `015_registration_details.sql`:

```sql
ALTER TABLE public.tournament_registrations
  ADD COLUMN reg_display_name text,
  ADD COLUMN reg_whatsapp     text,
  ADD COLUMN reg_club_name    text,
  ADD COLUMN reg_ign_tag      text;
```

Nullable at the DB level — existing registrations predate this feature and can't be
backfilled with real data. "Required" is enforced in the application layer for new
registrations only (server action validates all four are non-empty before creating the
pending row). No RLS policy changes needed: these columns fall under the existing
`tr_own_insert` (player can set on insert) / `tr_select` (owner + staff can read) /
`tr_staff_update` policies already in place.

**Registration flow** (`components/tournament/RegistrationPanel.tsx`,
`lib/tournaments/actions.ts`):

- The `can_register` / `complete_payment` states of `RegistrationPanel` currently render
  a single "Register — ₦500" button that submits straight to `registerForTournament`,
  which redirects to Paystack. That form gains four required fields, using the existing
  `Field` component (`components/dashboard/FormField.tsx`):
  - Display name — `defaultValue` prefilled from `profiles.display_name`, editable.
  - WhatsApp number — `defaultValue` prefilled from `profiles.whatsapp_number` (the same
    column the Termii notification system reads), editable.
  - Club name — blank every time (per-tournament, per-game; a player's club in EA FC
    Mobile may differ from their club in eFootball).
  - In-game player ID / tag — blank every time, same reasoning.
- `registerForTournament` validates all four are non-empty server-side (never trust
  client-side `required`) and writes them onto the pending registration row at creation
  time, before the Paystack redirect. If the player already has a `pending` row (retrying
  payment), the fields are updated on that existing row rather than duplicated.
- profiles.display_name / whatsapp_number are **not** overwritten by what the player
  types here — this is registration-scoped data only, per the "different club names
  across different games" requirement in the ask.

**Admin view:** new page `app/admin/tournaments/[id]/registrations/page.tsx`, linked from
the tournament edit page and bracket page nav (alongside the existing "Manage matches"
link). Table columns: player (username/display name), the four `reg_*` fields, payment
status, registered-at. This page is also where #17's search box lives (see below).

**Explicitly out of scope:** no new approval/rejection status. Payment still
auto-confirms via the existing Paystack webhook exactly as it does today; this page is
for Samuel to visually verify players (catch impersonation, mismatched club claims,
etc.) using the admin tools that already exist (flags, registration removal) — not a new
blocking gate.

---

## #16 — League table + Leaderboard

Two independent surfaces.

### League table (per-tournament group standings)

Already built. `components/bracket/StandingsTable.tsx` renders P/W/D/L/GD/Pts from
`StandingRow` (`lib/tournaments/standings.ts`), which already computes `goalsFor` and
`goalsAgainst` per player — they're just not currently rendered as columns. The only
change: add two columns, GF and GA, between L and GD. Purely presentational; no backend
or data-shape change. `sortStandings()` and the underlying `group_memberships` table
already carry everything needed.

### Leaderboard (`/rankings`, platform-wide)

Already built as a single table sorted by wins. Becomes 3 switchable tabs — **Wins /
Sentinel Score / Goals** — using the same tab-button pattern already used in
`GroupStage.tsx`.

- One query, unchanged from today: `profiles` filtered by
  `total_matches >= RANKING_MIN_MATCHES`, selecting `wins, sentinel_score, goals_scored`
  (and the other columns already selected). `goals_scored` is a maintained aggregate
  column on `profiles` — the same one already read on this page — updated whenever a
  match result is confirmed. **No new aggregation query**, no new join.
- `app/(public)/rankings/page.tsx` becomes a client-wrapped component holding tab state;
  `rankPlayers()` (`lib/rankings/leaderboard.ts`) gets a `sortBy: 'wins' | 'score' |
  'goals'` parameter and re-sorts the same in-memory array three ways.
- `LeaderboardTable` gets a `metric` prop so the right-hand emphasized column (currently
  always "W") switches to match the active tab.

---

## #17 — Admin player search

A single reusable client component, `components/admin/PlayerSearch.tsx` — a text input
that filters an already-loaded array by case-insensitive substring match against
username, display name, and (where available) club name. No new server queries or
debouncing needed: every admin list this attaches to is scoped to one tournament and is
already small (≤64 players).

Wired into three existing/new pages:

1. **Registrations list (#15, new)** — filters on username, display name, club name
   directly (native to this table).
2. **Admin bracket page** (`app/admin/tournaments/[id]/bracket/page.tsx`) — filters the
   group standings rows by username. To make club-name search work here too, the
   `loadBracketView` query gains a join against `tournament_registrations` (by
   `tournament_id` + `player_id`) to pull `reg_club_name` alongside each standings row.
3. **Admin results page** (`app/admin/results/page.tsx`) — filters the match queue by
   either player's username; same `reg_club_name` join added to the existing matches
   query for club-name search.

---

## #18 — Tournament rules

**Schema:** new column `rules text` on `tournaments` (same migration as #15/#20,
`015_registration_details.sql` — see consolidated migration note at the end).

**Admin:** `TournamentForm` gets a `rules` textarea (Markdown source), placed after
Description. Placeholder text hints at Markdown syntax (`**bold**`, `- list`, `[text](url)`).

**Display:** tournament detail page renders `tournaments.rules` as Markdown, positioned
prominently above the `RegistrationPanel`, using `react-markdown` (new dependency — small,
actively maintained, escapes raw HTML by default so untrusted Markdown can't inject
script tags; not worth hand-rolling a parser for one field). If `rules` is empty/null,
the whole rules block is omitted.

**Registration gate:** `RegisterForm` adds a required checkbox — "I have read and agree
to the rules" — that:
- Disables the submit button client-side until checked (immediate feedback).
- Is also checked server-side in `registerForTournament`: the action rejects the
  submission with an error if the `agreedToRules` field isn't `"true"` in the FormData,
  the same way every other Paystack-adjacent check in that action already re-validates
  server-side rather than trusting the client.
- **What this actually enforces:** only that the checkbox was ticked at submit time —
  there's no way to verify a player actually read the rules, and this spec doesn't
  attempt to. It's a lightweight "you were shown this and acknowledged it" gate, the same
  kind of TOS-agreement checkbox used everywhere else on the web — not a comprehension
  check.
- If `rules` is empty, this checkbox is skipped entirely (nothing to agree to) — the
  registration form behaves exactly as it does today.

---

## #19 — Player fixture schedule

Already ~90% built. `components/dashboard/FixtureCard.tsx` +
`lib/dashboard/fixtures.ts` already render a "My fixtures" section on `/dashboard`
grouped into Live / Upcoming / Completed, each card showing opponent name, tournament
title, and scheduled time, with Upcoming sorted ascending by date. This satisfies the
core ask ("full list ... not just you have a match").

**Change:** polish only. `FixtureCard` gains the match's round label (e.g. "Quarter
Final", "Group Stage") next to the tournament name, so each row reads as a complete
schedule entry. `DashboardMatchInput.round` is already fetched by the dashboard query
(used for bracket logic elsewhere) — just needs threading into the card's display string.
No changes to `bucketFixtures()`, no new query.

---

## #20 — Registration deadline countdown

`tournaments.registration_end timestamptz` already exists (nullable, already editable in
`TournamentForm`) — no schema change needed for this feature specifically.

New client component `components/tournament/RegistrationCountdown.tsx`, rendered on the
tournament detail page above `RegistrationPanel`:

- Client-side `setInterval` ticking every second, computing `registration_end - now`.
- Renders `Dd Hh Mm Ss` remaining, mobile-first compact format.
- Once `now >= registration_end`, switches to static text: "Registration closed."
- If `registration_end` is `null`, the component renders nothing — `RegistrationPanel`'s
  existing state-based messaging (`can_register` / `closed` / etc.) already covers that
  case without a countdown.
- Purely presentational — does not gate the register button itself; `RegistrationPanel`
  already derives its view state (`can_register`/`closed`/etc.) server-side from
  `checkCanRegister()`, which remains the source of truth. The countdown and the actual
  gate can theoretically disagree for a few seconds around the deadline (client clock
  drift) — acceptable, since the server-side check is what actually blocks registration.

---

## Consolidated migration

One migration file, `015_registration_details.sql`, covers #15, #18, and (documents,
doesn't alter) #20's existing column:

```sql
ALTER TABLE public.tournament_registrations
  ADD COLUMN reg_display_name text,
  ADD COLUMN reg_whatsapp     text,
  ADD COLUMN reg_club_name    text,
  ADD COLUMN reg_ign_tag      text;

ALTER TABLE public.tournaments
  ADD COLUMN rules text;
```

## New dependency

`react-markdown` — added for #18's rules rendering. No other new dependencies; #16, #17,
#19, #20 are built entirely from existing libraries and patterns already in the codebase.

## Explicitly out of scope

- No formal registration approval/rejection workflow (#15).
- No server-side aggregation changes for the leaderboard — it reads existing maintained
  columns (#16).
- No debounced/server-side search — admin lists are small and already fully loaded (#17).
- No restructuring of the dashboard fixtures section into a flat list or separate page —
  the existing grouped view stays (#19).
- No verification that a player actually read the rules — the checkbox only confirms it
  was checked at submit time (#18).
