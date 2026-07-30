# Admin fixture WhatsApp buttons + 1-0 walkover score — design

Date: 2026-07-30

Two independent changes, specced together because they were requested together and shipped in one
commit (`7ec5d1d`). Nothing in the WhatsApp work touches scoring, and nothing in the walkover
change touches admin UI — they share only a release.

Written after implementation, at the user's request: the work was approved in conversation and
built directly ("fast fast"), so this records the agreed design rather than preceding it. The
as-built code matches what follows.

## Part 1 — Admin WhatsApp buttons on each fixture

### Problem

Players have had a way to reach each other since the dashboard fixture card shipped:
`buildOpponentWhatsAppUrl` (`lib/dashboard/fixtures.ts:117`) turns the opponent's
`tournament_registrations.reg_whatsapp` into a `wa.me` link with a pre-filled coordination
message.

Admin had nothing. The fixture rows on `/admin/tournaments/[id]/matches` carry scheduling,
stream URL and go-live controls, but no player contact at all — the only place a number appeared
anywhere in the admin UI was as inert plain text in a column of the registrations table
(`components/admin/RegistrationsTable.tsx:82`).

In practice that means seeing a fixture that hasn't been played, then cross-referencing two player
names against a separate registrations page, against WhatsApp contacts, to work out whose number is
whose — repeated per fixture, per chase. The user's framing: *"we will start running here and there
trying to match numbers and all that... it's stressful."*

The job to be done is not "display phone numbers." It's: from the row where you notice a match is
stalling, reach one specific player about that specific match in one tap.

### Scope

The tournament matches page only (`app/admin/tournaments/[id]/matches/page.tsx` →
`components/admin/MatchRow.tsx`). Explicitly considered and deferred: the match review page, the
no-show banner, the results queue, and making the registrations table's WhatsApp column tappable.
Deferred, not rejected — the URL builder is a plain exported function, so each is a small addition
later.

### Number resolution

Two candidates, tried in order, first one that parses wins:

1. `tournament_registrations.reg_whatsapp` for that player **in this tournament** — what they gave
   for this event, and what players already see of each other
2. `profiles.whatsapp_number` — their account-level number

Both run through the existing `toWhatsAppNumber` (`lib/dashboard/fixtures.ts:109`), which
normalizes Nigerian formats (`0801…`, `+234801…`, `234801…`, `801…`) into the `234`-prefixed form
`wa.me` requires.

Falling through on a **parse failure**, not merely on a null, is the deliberate part: a player who
typed something unusable at registration ("ask me on IG") still gets reached via their profile
number. Preferring registration over profile matters too — a player may register with a different
number than their account carries, and the tournament-specific one is the more current intent.

### Message copy

Three variants, selected by the fixture's schedule state. Times render via `formatFixtureDate`
(`lib/format.ts:111`), so everything is West Africa Time like the rest of the product.

| Fixture state | Message |
|---|---|
| Timed | `Hi Chidi — SentinelX admin here. Your DLS Cup 4 match vs Tunde is scheduled for 8 Jul, 20:00. Please confirm you'll be ready to play.` |
| Full day | `Hi Chidi — SentinelX admin here. Your DLS Cup 4 match vs Tunde is scheduled for 8 Jul 2026 — you can play any time that day. Please confirm you'll be ready.` |
| Unscheduled | `Hi Chidi — SentinelX admin here about your DLS Cup 4 match vs Tunde. It's not scheduled yet — when are you available to play?` |

An undecided opponent (knockout slot not yet filled) renders as "your opponent".

### Structure

New module `lib/matches/admin-whatsapp.ts`, mirroring the existing
`lib/matches/recording-whatsapp.ts` exactly — a pure function importing `toWhatsAppNumber`, with
its own unit tests. Two exports:

- `resolvePlayerWhatsApp(regWhatsapp, profileWhatsapp)` — the fallback chain above
- `buildAdminPlayerWhatsAppUrl({...}) → string | null` — the full link, null when unreachable

Data flow: the page is already a Server Component behind `requireStaff()`. It fetches matches and
this tournament's registrations in one `Promise.all`, builds a `player_id → reg_whatsapp` map, and
constructs both URLs **server-side**, passing finished strings into `AdminMatchRow` as
`playerAWhatsAppUrl` / `playerBWhatsAppUrl`.

Two reasons the URLs are built on the server rather than in the component:

1. All the branching logic stays in a pure, unit-testable function; `MatchRow` stays a renderer
2. No phone number reaches the client bundle for a player admin can't message anyway

Staff read `tournament_registrations` through the ordinary RLS client (`createClient()`), exactly
as `app/admin/tournaments/[id]/registrations/page.tsx` already does. No admin-client escape hatch.

The match query gains `id` and `whatsapp_number` on both `profiles!matches_player_*` joins. A
separate `PlayerRef` type covers this; the narrower `ProfileRef` stays for the flagged-matches
query, which needs neither field.

### UI

A `WhatsAppChip` in `MatchRow.tsx`, rendered as a wrapping row directly under the "A vs B" header
so it reads as being about those two names. WhatsApp green (`#25D366`) with the brand glyph,
matching the share buttons used elsewhere in the product. Bye rows show the single player's chip.

Unreachable players render a muted, non-clickable `Chidi · no WhatsApp` rather than the chip
vanishing. A missing button is ambiguous — it could mean the feature is broken. A labelled one
tells admin *which* player needs chasing another way, which is itself the information they need.

### Testing

`lib/matches/admin-whatsapp.test.ts` — 8 cases: all three copy variants, registration preferred
over profile, fallback on a null registration number, fallback on an *unparseable* registration
number, null when neither candidate parses, and the undecided-opponent wording.

## Part 2 — Walkovers record 1-0, not 3-0

### Problem

`declareNoShowWinner` (`lib/matches/noshow-actions.ts`) hardcoded a 3-0 scoreline when admin awards
a walkover. It is the only code path in the repo that writes a walkover score.

The scoreline is not cosmetic. Those goals flow into three places:

- group-stage **goal difference** and goals-for tiebreakers (`lib/tournaments/standings.ts:49`)
- **`profiles.goals_scored`** (`lib/scoring/stats.ts`)
- **Golden Boot** selection (`lib/hall-of-fame/awards.ts:39`)

So a 3-0 handed a player who never kicked a ball three goals toward the Golden Boot and a +3 swing
in their group table. 1-0 is the smallest margin that still decisively settles the tie.

### Change

`WALKOVER_SCORE = 1`, a named constant carrying the reasoning above in a comment so it doesn't get
"fixed" back to 3. Applied at the score write, plus the two copy surfaces that quote the scoreline:
the winner's in-app notification body, and the admin form's helper and success text
(`components/admin/DeclareNoShowWinnerForm.tsx`).

Deliberately untouched: `markBothNoShow` still writes 0-0 (a mutual no-show is a goalless draw —
unrelated), and knockout forfeits keep their existing shape.

### No migration or backfill

Checked against production on 2026-07-30:
`select resolution, round, score_a, score_b, count(*) from matches where resolution = 'walkover'
group by 1,2,3,4` returned zero rows. There is no walkover history to rewrite and no denormalized
stat to recompute. The change applies to every walkover from here on.

Two earlier documents state the old rule and are now historically inaccurate on this point:
`docs/superpowers/plans/2026-07-28-noshow-resolution-and-player-substitution.md:14` and
`docs/superpowers/specs/2026-07-28-noshow-resolution-and-player-substitution-design.md:73`. Both
carry a pointer to this spec.

## Verification

- 532 tests pass across 81 files (8 new)
- `tsc --noEmit` clean
- `npm run build` clean
