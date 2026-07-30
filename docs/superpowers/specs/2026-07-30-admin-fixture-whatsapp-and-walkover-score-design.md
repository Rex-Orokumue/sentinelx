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

Two admin surfaces:

1. The tournament matches page (`app/admin/tournaments/[id]/matches/page.tsx` →
   `components/admin/MatchRow.tsx`)
2. The **Fixtures tab** of the admin bracket page (`app/admin/tournaments/[id]/bracket/page.tsx` →
   `AdminBracketView` → `GroupStage` → `MatchCard`) — added 2026-07-30 on user request, because
   that tab is where a stalling group match is actually noticed

Explicitly considered and deferred: the match review page, the no-show banner, the results queue,
and making the registrations table's WhatsApp column tappable. Deferred, not rejected — the URL
builder is a plain exported function, so each is a small addition later.

### Constraint: the bracket components are public

`GroupStage` and `MatchCard` are shared verbatim between the admin bracket page and the **public**
one (`app/(public)/tournaments/[slug]/bracket/page.tsx:108`). Adding contact links to them
naively would publish every player's phone number to anyone viewing a bracket.

So the links are an **optional prop**, never a fetch inside the shared component:

- `MatchCard` takes `contact?: { a, b }`; absent ⇒ it renders exactly as before, byte for byte
- `GroupStage` takes `contacts?: FixtureContacts` and indexes it per match
- The admin page passes the map; the public page passes nothing and is unmodified

Equally, the numbers are fetched in the admin page, **not** in `loadBracketView` — that loader is
shared with the public page, so it must never learn a phone number in the first place.

`MatchCard`'s body is a `<Link>`. The chips render as a sibling *below* it rather than inside:
an anchor cannot legally nest in another anchor, and tapping a player's name must open WhatsApp
rather than navigating to the match page.

### Number resolution

Two candidates, tried in order, first one that parses wins:

1. `tournament_registrations.reg_whatsapp` for that player **in this tournament** — what they gave
   for this event, and what players already see of each other
2. `profiles.whatsapp_number` — their account-level number

Both run through `parsePlayerPhone` (`lib/phone/number.ts`) — see Part 3.

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
`lib/matches/recording-whatsapp.ts` exactly — pure functions importing `toWhatsAppNumber`, with
their own unit tests. Three exports:

- `resolvePlayerWhatsApp(regWhatsapp, profileWhatsapp)` — the fallback chain above
- `buildAdminPlayerWhatsAppUrl({...}) → string | null` — the full link, null when unreachable
- `buildFixtureContactMap({...}) → FixtureContacts` — both links for a whole list of fixtures,
  keyed by match id, for list surfaces like the Fixtures tab

`FixtureContacts` is a plain `Record`, not a `Map` or a callback, because it crosses a Server →
Client component boundary and must be serializable.

The shared chip lives in `components/shared/WhatsAppChip.tsx` (lifted out of `MatchRow` when the
bracket page needed it) so both surfaces render an identical control.

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

A `WhatsAppChip` rendered as a wrapping row directly under the two player names — under the
"A vs B" header on the matches page, under the score card on the Fixtures tab — so it reads as
being about those names. WhatsApp green (`#25D366`) with the brand glyph,
matching the share buttons used elsewhere in the product. Bye rows show the single player's chip.

Unreachable players render a muted, non-clickable `Chidi · no WhatsApp` rather than the chip
vanishing. A missing button is ambiguous — it could mean the feature is broken. A labelled one
tells admin *which* player needs chasing another way, which is itself the information they need.

### Testing

`lib/matches/admin-whatsapp.test.ts` — 13 cases.

`buildAdminPlayerWhatsAppUrl` (8): all three copy variants, registration preferred over profile,
fallback on a null registration number, fallback on an *unparseable* registration number, null
when neither candidate parses, and the undecided-opponent wording.

`buildFixtureContactMap` (5): keyed by match id with each player addressed about the other, only
the unreachable side nulled, per-player profile fallback, per-fixture schedule state carried into
each message, and an empty map for no fixtures.

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

### Opponent contact in the message

The chase message ends with the opponent's number in two forms — readable (to save as a contact or
dial) and a `wa.me` link (which opens a chat even when the number isn't saved, the actual pain
point):

```
Tunde: +234 808 765 4321
Message them: https://wa.me/2348087654321
```

Omitted entirely when the opponent has no valid number. This is not a new disclosure: players
already see each other's numbers via `buildOpponentWhatsAppUrl` on their own dashboard.

The same links are appended to the `noshow_needs_decision` staff alert
(`lib/notifications/templates.ts`), so a stalled match can be chased from the notification without
opening the dashboard to look numbers up. Only reachable players are listed; the block is dropped
when neither is.

Deliberately **not** extended to the walkover notification: that one goes to the winning player,
not to staff, and telling the winner how to reach the opponent who just no-showed them serves no
purpose.

## Part 3 — Country-aware phone parsing

### Problem

`toWhatsAppNumber` stripped every non-digit **first** — discarding the `+` that says "this number
is already international" — then applied Nigeria-only length rules. Checked against all 79 stored
numbers on 2026-07-30, five were mishandled, and the two causes differ in kind:

| Player | `profiles.country` | Stored | Old result |
|---|---|---|---|
| InaPower | South Africa | `0704…` (10 digits) | `2340704…` — **a wrong number, silently** |
| KIPLANGAT | Kenya | registration `0712…` | `2340712…` — **a wrong number, silently** |
| KIPLANGAT | Kenya | profile `+254…` | `null` — shown as "no WhatsApp" |
| (one registration) | — | `+268…` | `null` — shown as "no WhatsApp" |

These are not malformed numbers. A South African mobile is 10 digits starting `0`; so is a Kenyan
one. Their national formats collide with Nigeria's, and the parser resolved the collision by
assuming Nigeria and inventing a plausible-looking wrong number.

That reaches further than broken links: the same function gates **phone-verification OTP delivery**
(`lib/phone/actions.ts`), so a login code could be sent to a stranger's WhatsApp.

### Solution

`libphonenumber-js`, parsing against **the player's own country** rather than a hardcoded region.
`profiles.country` already records it and was simply never consulted.

New module `lib/phone/number.ts` — moved out of `lib/dashboard/fixtures.ts`, a poor home for
something that phone verification, data support, friendlies, the dashboard and admin all depend on:

- `countryToRegion(freeText)` — country name → ISO region. The index is built from
  `Intl.DisplayNames` over `getCountries()`, so all 245 countries resolve without a hand-maintained
  table. A small alias map covers what Intl can't: demonyms and colloquial names players actually
  type — live data already contains `Nigerian` alongside `Nigeria`. Defaults to `NG`.
- `parsePlayerPhone(raw, { country })` → `{ waNumber, e164, display } | null`
- `toWhatsAppNumber(raw, { country })` — thin wrapper, keeps the existing call sites working

Validation is the point: an impossible number now returns `null` instead of being coerced into a
real-looking wrong one. "No WhatsApp" is a worse-looking but far better outcome than a link to a
stranger.

A leading `+` makes a number self-describing, and the region is then ignored — handled natively.

Registration numbers are parsed with the player's **profile** country, since a registration row
carries no country of its own. That alone rescues KIPLANGAT's `0712…`.

### No migration

Numbers are stored **exactly as typed** (`lib/profile/actions.ts:33`); `requestPhoneCode`
normalizes only into `phone_verifications.phone`, never back into `profiles`. Normalization is
purely read-time, so fixing the parser fixes all five rows instantly — everywhere, OTP included —
with zero rows touched.

A migration was considered and rejected: every one of the five is a *valid* number in its own
country, so rewriting stored values could only lose information, and would risk baking in exactly
the mangling being fixed.

### Client bundle

libphonenumber-js metadata is ~120KB and must never reach a browser bundle. One client component
did drag it in: `components/match/ResultSubmissionForm.tsx`, on the **public** match page, imported
`buildRecordingWhatsAppUrl` directly. Fixed by the rule the rest of this work already follows —
**the server builds the URL, the client receives a finished string**.

Verified after a clean rebuild: `grep -rl libphonenumber .next/static/chunks` returns nothing, and
First Load JS shared by all is unchanged at 87.3 kB.

## Verification

- 555 tests pass across 82 files
- `tsc --noEmit` clean
- `npm run build` exits 0 (compile **and** lint)
- No `libphonenumber` in any client chunk after a clean rebuild
