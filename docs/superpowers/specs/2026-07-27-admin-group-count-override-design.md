# Admin Group Count Override — Design

**Routes:** modifies `/admin/tournaments/[id]/bracket`
**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

`groupCountFor(n)` (`lib/tournaments/draw.ts`) maps a paid-player count to a single fixed group
count per the documented tiers (≤8→0, 9–16→2, 17–32→4, 33–64→8), and `generate()`
(`lib/tournaments/bracket-admin-actions.ts`) calls it unconditionally — there is currently **no**
way for admin to pick a different group count. CLAUDE.md's tournament-logic section already says
"Admin can override before publishing," but that override was never built. This came up because a
32-player tournament defaulted to 4 groups of 8, and admin wanted the option to run 8 groups of 4
instead for that specific event.

**Scope:** add the override control to both bracket-generating actions
(`closeRegistration`, `generateBracket`). Do not change the default tiers — `groupCountFor` stays
the fallback when admin doesn't choose an override.

## Valid group counts — `lib/tournaments/draw.ts`

```ts
export function validGroupCounts(n: number): number[]
```

Returns every group count that keeps each group within the documented 4–8-players-per-group rule:
- `n <= 8` → `[0]` (straight knockout only; no group-stage option).
- `n > 8` → integers from `ceil(n/8)` to `floor(n/4)` inclusive.

Worked cases: n=9 → `[2]` (ceil(9/8)=2, floor(9/4)=2). n=16 → `[2,3,4]` (ceil(16/8)=2,
floor(16/4)=4). n=17 → `[3,4]`. n=32 → `[4,5,6,7,8]`. n=33 → `[5,6,7,8]`. n=64 →
`[8,9,10,11,12,13,14,15,16]` (the 4–8-per-group rule
applied uniformly extends past the documented 8-group tier at this size — not artificially capped,
since the knockout stage already handles an arbitrary advancer count via byes, see
`collectAdvancers`/`knockoutRound1`).

`groupCountFor(n)` is unchanged and still used as the default selection.

## Server actions — `lib/tournaments/bracket-admin-actions.ts`

`closeRegistration` and `generateBracket` both read an optional `groups` field from `formData`:

1. Parse `formData.get('groups')` as an integer (absent/unparseable → `undefined`).
2. Compute `const options = validGroupCounts(seeded.length)` from the just-loaded seeded list —
   never trust a count computed client-side, since paid registrations can change between page
   render and submit.
3. Resolve `const g = options.includes(requested) ? requested : groupCountFor(seeded.length)` —
   an invalid or missing submission silently falls back to the tiered default rather than erroring,
   since the default is always a safe, valid choice.
4. Pass the resolved `g` into `generate(admin, id, seeded, g)`. `generate` takes `g` as a parameter
   instead of computing it internally via `groupCountFor` — same branching on `g === 0` vs `g > 0`
   as today.

No other behavior of `generate` changes (cleanup, seeding, snake distribution, round-robin pairing,
knockout-round-1 all unchanged).

## Bracket admin page — `app/admin/tournaments/[id]/bracket/page.tsx`

Fetch the paid registration count (`tournament_registrations` where `payment_status = 'paid'`,
head-count query) alongside the existing tournament/view fetch, and pass it to `BracketActions` as
`paidCount`.

## `components/admin/BracketActions.tsx`

Compute `const options = validGroupCounts(paidCount)` client-side (pure function, safe to
duplicate — the server re-validates regardless). When `options.length > 1` (i.e. there's an actual
choice — not the `≤8` or single-valid-value cases), render a `<select name="groups">` inside both
the `registration_open` form (Close registration & generate bracket) and the
`registration_closed` re-roll form, listing each option, defaulting to `groupCountFor(paidCount)`.
When `options.length <= 1`, render nothing extra — the forms behave exactly as they do today.

The publish form is unaffected — group count is fixed once generated/re-rolled.

## Testing

Vitest on `lib/tournaments/draw.ts`:
- `validGroupCounts` boundaries: 8→`[0]`, 9→`[2]`, 16→`[2,3,4]`, 17→`[3,4]`, 32→`[4,5,6,7,8]`,
  33→`[5,6,7,8]`, 64→`[8,9,10,11,12,13,14,15,16]`.

Vitest (or equivalent) on the resolution logic in `bracket-admin-actions.ts`:
- A valid submitted `groups` value (e.g. `8` for 32 players) is used as-is.
- An out-of-range submitted value (e.g. `3` for 32 players) falls back to `groupCountFor(32)` = 4.
- A missing `groups` field falls back to `groupCountFor(n)` (existing default behavior, unchanged).

Page/component wiring is exercised via the build and manual admin testing (select a non-default
group count for a 32-player tournament, confirm the resulting bracket has that many groups).

## Consistency notes

- Mobile-first; the new `<select>` follows the existing form styling in `BracketActions.tsx`.
- Does not touch roadmap scope — this is a fix to already-shipped admin bracket generation
  (finishes the "admin can override" behavior CLAUDE.md already documents).
