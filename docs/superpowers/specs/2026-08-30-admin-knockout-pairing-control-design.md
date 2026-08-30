# Admin Knockout Pairing Control — Design

**Date:** 2026-08-30
**Status:** Approved for planning

## Problem

When a knockout round finishes (or the group stage finishes), the system
automatically generates the next round's fixtures. The pairing logic —
`pairWinners` (interleave byes with match-winners, pair by position) and
`knockoutRound1` (seed-order byes, high-vs-low) in `lib/tournaments/` — gives the
admin **no control** over who plays whom, and no safe way to correct it.

On 2026-08-30 this bit us live: the admin had planned the SentinelX Community Cup
II quarter-finals as HIM v Arole / AAGREATTEAM v chiboy / Martins v Efezinofc /
Hardex12 v bigwizz and the players had already played to that bracket. Confirming
the last round-of-16 match auto-generated a different pairing. It was corrected by
hand-editing four `matches` rows in the database.

Two gaps:

1. No admin control over knockout pairings.
2. A separate, related bug surfaced during investigation: players who sign up
   (Google or email) and register for a tournament **before ever visiting
   `/dashboard`** never pass the `/onboarding/username` gate, so their profile has
   `username = NULL` / `display_name = NULL` and they appear as "TBD" in the
   bracket and group tables. Three players in the FC Mobile Premier League hit
   this. Their names were backfilled manually; the flow gap remains.

## Scope

- **Part 1 — Hold-and-arrange:** an opt-in per-tournament flag that stops
  auto-generation of knockout rounds and lets the admin arrange each round's
  pairings before players are notified.
- **Part 2 — Rearrange an already-generated round:** swap the pairings of a
  knockout round whose matches exist but haven't been played, updating the rows
  in place and re-notifying affected players.
- **Part 3 — Registration username gate:** refuse tournament registration (and
  guide the user to `/onboarding/username`) when the caller has no claimed
  username.

Explicitly **out of scope:** designing a full bracket template up front
("semi 1 = winner QF1 vs winner QF4" before any round is played); substituting a
different player into a knockout slot (only re-pairing the existing participants
is allowed); any change to group-stage pairing (already covered by
`movePlayerToGroup`).

---

## Part 1 — Hold-and-arrange

### Approach

**Chosen: do not create the next round until the admin arranges it.** When the
flag is on, a finished round simply does not trigger insertion. "The round does
not exist yet" is a state the whole app already handles — it is how every
not-yet-reached round looks today — so no new match status, and no changes to the
public bracket, the no-show cron, or full-day alerts.

Rejected: inserting the next round as "unreleased" rows. That needs a new match
lifecycle state threaded through ~5 read sites (public bracket view, no-show
sweep, full-day alerts, standings, admin views). More surface, more risk, no
benefit over holding.

### The flag

New column:

```sql
alter table tournaments
  add column manual_knockout_pairing boolean not null default false;
```

- Added to `tournamentSchema` (`lib/tournaments/admin-schema.ts`) and persisted by
  the create/update actions in `lib/tournaments/admin-actions.ts`.
- Rendered as a checkbox on the tournament new/edit form:
  "Arrange knockout pairings manually" with helper text
  "When on, completed rounds won't auto-generate the next round — you'll arrange
  each round's fixtures yourself before players are notified."
- Regenerate `lib/supabase/types.ts`.
- Default `false` ⇒ existing tournaments and anyone who ignores the checkbox get
  byte-for-byte today's behaviour.
- Can be toggled mid-tournament; it takes effect from the next round that would
  be generated. (Adopting it for the Community Cup II semis is exactly this
  path.)

### Held generation

Both auto-generators live in `lib/matches/verify-actions.ts`. Each gets one early
return, gated on the flag, placed **after** the work that must still happen:

- `recomputeGroupAndMaybeAdvance`: standings are still recomputed; the tournament
  is still completed if it is `round_robin`; only the first-knockout-round
  insertion is skipped.
- `advanceKnockout`: the `roundResolved` / `nextRoundName` / "already exists"
  checks still run; only the insertion + `notifyNewFixtures` is skipped.

`createThirdPlaceMatch` is **not** gated — the third-place pair is forced (the two
semi-final losers), nothing to arrange. `completeTournamentIfFinal` is untouched.

### "Round ready to arrange" detection

A pure helper, `pendingKnockoutRound(...)`, computed server-side for the admin
bracket page. Returns `null` unless the flag is on and one of:

- **First knockout round:** groups exist, every `round = 'group'` match is
  `completed`, and no `round != 'group'` match exists. Advancer set =
  `collectAdvancers(standingsPerGroup)` (same call the auto-generator uses).
- **Subsequent round R+1:** every match in round R is `completed` / `bye` /
  `forfeited` (`roundResolved`), `nextRoundName(R)` is non-null, and that next
  round has no matches. Participant set = bye-winners + match-winners of round R.

The helper also returns the **slot shape** for that round — `b` bye slots and `m`
match slots, from `knockoutRound1` (first round) or `pairWinners` (later rounds)
math — and the **default assignment** (what auto-generation would have produced),
so the editor opens on current behaviour, never a blank slate. Each participant
carries a human label: `"Group A runner-up"` for the first round, or
`"Winner: HIM vs Hardex12"` for later rounds.

### Pairing editor — `components/admin/KnockoutPairingEditor.tsx`

Client component, mobile-first (375px). One row per slot — bye slots first, then
match slots. Each slot position is a `<select>` listing every participant,
defaulted to the computed assignment. Client-side validation: each participant
used exactly once; the "Create <round>" button is disabled until the assignment
is a valid permutation, with an inline hint naming any duplicated/missing player.

Rendered by `AdminBracketView` whenever `pendingKnockoutRound(...)` is non-null,
above the bracket tree, in a callout: "Round of 16 complete — arrange the
quarter-finals."

### Server action — `createKnockoutRound`

New file `lib/tournaments/knockout-pairing-actions.ts`. Signature (Server Action,
`useFormState`-compatible): reads `tournamentId`, `round`, and the slot
assignments from `FormData`.

1. `requireStaff()`.
2. Load the tournament; the flag being on is not required (harmless if toggled
   off between the round finishing and the admin arranging it — the action is
   still the intended path).
3. **Re-derive** the true participant set and slot shape server-side, exactly as
   `pendingKnockoutRound` does — never trust the client's participant list or
   counts.
4. Validate (`validateAssignment`, below): submitted assignment is a perfect
   matching over exactly the true set, with the exact bye count.
5. Idempotency: refuse if `round` already has any matches for this tournament
   ("This round has already been created.").
6. Insert rows — `status = 'scheduled'` for pairs, `status = 'bye'` for byes —
   with the same `nextRoundScheduledAt` scheduling the auto-generator applies.
7. `notifyNewFixtures(...)`.
8. `revalidatePath` the admin bracket, public bracket, and tournament pages.

Pure helpers, `lib/tournaments/knockout-pairing.ts` (no DB, unit-tested):

- `defaultAssignment(participants, slotShape)` → the assignment auto-generation
  would produce.
- `validateAssignment(trueParticipantIds, slotShape, assignment)` →
  `{ ok: true } | { ok: false, reason }`. Checks: right number of bye slots and
  match slots; every assigned id is in `trueParticipantIds`; each id used exactly
  once; no empty slot.

---

## Part 2 — Rearrange an already-generated round

Covers the round that was **already auto-generated** — either before the flag was
turned on, or in a tournament not using the flag at all (the 2026-08-30 incident
class). Without it, mid-tournament adoption only helps from the *next* round.

### Server action — `swapKnockoutPairing`

Same file, same participant-set validation as `createKnockoutRound`, but operates
on existing rows.

1. `requireStaff()`.
2. Load every match in `(tournament_id, round)`.
3. **Guard:** if any of them is `live`, `completed`, `disputed`, `forfeited`, or
   carries a score, refuse — "Results are already in for this round; pairings are
   locked." Only `scheduled` / `bye` rows may be rearranged.
4. Derive the true participant set from those rows (both player slots + bye
   players). Validate the submitted assignment is a permutation of it, with the
   same bye count as exists now.
5. Apply the new assignment by **updating the existing rows in place** — keep the
   match `id`s, `scheduled_at`, `youtube_stream_url`, `replay_url`,
   `is_full_day`. A row that becomes a bye (or stops being one) has its
   `status` and `player_b_id` adjusted accordingly. Minimise writes: only rows
   whose `(player_a_id, player_b_id, status)` actually changed are updated.
6. **Re-notify** every player whose fixture changed — opponent different, or
   moved into/out of a bye — via the same `notifyNewFixtures` path
   (`match_assigned` in-app + push), so a stale "your opponent is X" notification
   is superseded. Players whose pairing is unchanged are not notified.
7. Revalidate the same paths as `createKnockoutRound`.

### Editor reuse

`KnockoutPairingEditor` is reused: when a knockout round exists, is fully
`scheduled` / `bye`, and its predecessor is resolved, `AdminBracketView` shows a
"Rearrange <round>" affordance (collapsed by default, so it is not visual noise)
that opens the same editor pre-filled with the **current** pairing and submits to
`swapKnockoutPairing`.

---

## Part 3 — Registration username gate

### Root cause

`resolveOnboardingGate()` (`lib/onboarding/gate.ts`) redirects a `username = NULL`
profile to `/onboarding/username`, but `lib/supabase/middleware.ts` only invokes
it for `pathname.startsWith('/dashboard')`. Registration happens on the public
`/tournaments/[slug]` page, which never triggers the gate.

### Fix

Two layers, mirroring how `/dashboard` is both middleware-guarded and
page-guarded:

1. **Server action** — `registerForTournament` (`lib/tournaments/actions.ts`),
   right after the `if (!user)` check: fetch `profiles.username` for `user.id`;
   if null, return
   `{ error: 'Claim a username before registering.', needsUsername: true }`.
   Extend `RegisterState` with the optional `needsUsername` flag.
2. **Registration form** — the `/tournaments/[slug]` page already loads the
   session; also load the caller's `username` and pass `hasUsername` to the
   registration form component. When false, replace the form's submit button with
   a "Claim your username to register" link to
   `/onboarding/username?next=/tournaments/<slug>`. The server-side check in (1)
   remains the trust boundary; this is just UX.

`/onboarding/username` already honours a `next` param on completion (verify during
implementation; add if missing).

### Not in this fix

Backfilling other existing `NULL`-username profiles who never registered — they
hit the gate the next time they open their dashboard, which is working as
designed. Only the registration path is being closed.

---

## Testing

Pure units (`lib/tournaments/knockout-pairing.test.ts`):

- `defaultAssignment` reproduces `pairWinners` / `knockoutRound1` output for
  representative sizes (8, 12, 6, 4).
- `validateAssignment`: accepts a valid permutation; rejects a duplicate, an
  unknown id, a missing id, wrong bye count, empty slot.

Action-level (`knockout-pairing-actions.test.ts`, mocked admin client):

- `createKnockoutRound`: rejects a non-permutation; rejects when the round
  already exists; on success inserts the right row shape and statuses and calls
  `notifyNewFixtures`.
- `swapKnockoutPairing`: rejects when any round match is `completed` / scored;
  on success updates rows in place (ids preserved) and notifies only the players
  whose fixture changed.

Generator gating (`lib/matches/verify-actions.test.ts`, extend existing):

- With `manual_knockout_pairing = true`, confirming the last group match does not
  insert a knockout round; confirming the last match of a knockout round does not
  insert the next round; standings/third-place/completion still happen.
- With the flag `false` (default), behaviour is unchanged.

Registration gate (`lib/tournaments/actions.test.ts` or sibling):

- `registerForTournament` returns `needsUsername` for a `NULL`-username caller and
  writes no registration row.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/0XX_manual_knockout_pairing.sql` | new column |
| `lib/supabase/types.ts` | regenerate |
| `lib/tournaments/admin-schema.ts` | `manualKnockoutPairing` field |
| `lib/tournaments/admin-actions.ts` | persist flag on create/update |
| tournament new/edit form component(s) | checkbox |
| `lib/matches/verify-actions.ts` | gate both auto-generators |
| `lib/tournaments/knockout-pairing.ts` | new — pure helpers |
| `lib/tournaments/knockout-pairing-actions.ts` | new — `createKnockoutRound`, `swapKnockoutPairing` |
| `lib/tournaments/bracket-view.ts` (or admin bracket page) | `pendingKnockoutRound` wiring |
| `components/admin/KnockoutPairingEditor.tsx` | new |
| `components/admin/AdminBracketView.tsx` | render editor for create + rearrange |
| `lib/tournaments/actions.ts` | registration username gate; add `needsUsername` to `RegisterState` |
| `/tournaments/[slug]` page + registration form component | `hasUsername`, claim-username CTA |
| test files as above | |
