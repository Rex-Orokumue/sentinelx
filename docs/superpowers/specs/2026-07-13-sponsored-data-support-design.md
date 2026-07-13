# Sponsored Data Support (#29) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** nothing new — reuses the existing tournament admin form pattern (`lib/tournaments/admin-schema.ts`) and the existing `wa.me` button pattern (`lib/dashboard/fixtures.ts`'s `buildOpponentWhatsAppUrl`, established in #25).

---

## 1. Goal

Admin can optionally attach a "data support" perk to a tournament — free-text description of what's offered, plus a WhatsApp number to claim it. Semi-finalists and finalists of that tournament see a "Claim Data Support" button on their dashboard that opens WhatsApp with a pre-filled claim message. Purely a claim-initiation button — no delivery tracking; Samuel handles fulfilment outside the platform, same trust model as every other admin-manual flow in this codebase.

## 2. Data model

**Migration `025_tournament_data_support.sql`:**

```sql
ALTER TABLE public.tournaments
  ADD COLUMN data_support_text      text,
  ADD COLUMN data_support_whatsapp  text;
```

Both nullable — a tournament with neither set simply never shows the claim button to anyone. No new table: this is tournament metadata, same shape as `rules` (#18) or `banner_url`, not an entity with its own lifecycle.

`lib/tournaments/admin-schema.ts`'s `tournamentSchema` gains:
```ts
dataSupportText: optionalText(500),
dataSupportWhatsapp: optionalText(20), // free-typed, same laxness as registration_details.whatsapp_number — normalized at link-build time (§4), not at input time
```
`createTournament`/`updateTournament` in `lib/tournaments/admin-actions.ts` map these straight through, same as every other field in that mapping. The admin tournament form (`app/admin/tournaments/new/page.tsx`, `app/admin/tournaments/[id]/edit/page.tsx`) gains two fields in the existing form, no new section/page.

## 3. Eligibility — "reached semi-final or final"

A player is eligible for a given tournament's data support the moment a `matches` row exists in that tournament with `round IN ('semi_final', 'final')` and `player_a_id = playerId OR player_b_id = playerId`. Row existence alone is the eligibility signal — regardless of whether that match has been played yet, was won or lost, or was a bye. `ROUND_ORDER` (`lib/tournaments/bracket.ts`) fixes these round names independently of bracket size (per CLAUDE.md's grouping table, a small tournament might jump straight to `quarter_final` or even `final` with no earlier rounds — but whenever a `semi_final` or `final` round exists for a given player, reaching it means exactly this row existing), so no new "placement" tracking is needed beyond the two round names in the query — this is the same reasoning already applied for prize eligibility in the wallet spec (#28 §5), kept separate here since a player can be dashboard-eligible for a data-support claim before any prize money exists.

A player can be simultaneously eligible across more than one tournament (e.g. semi-finalist this month, finalist last month) — the dashboard shows one row per eligible tournament, not just the most recent.

## 4. Claim button — dashboard, `wa.me` pattern reused exactly

New pure helper `lib/dashboard/data-support.ts`:
```ts
export function buildDataSupportClaimUrl(args: {
  whatsapp: string
  username: string
  tournamentTitle: string
  stage: 'semi-final' | 'final'
}): string | null
```
Mirrors `buildOpponentWhatsAppUrl` exactly: normalizes `whatsapp` via the existing `toWhatsAppNumber`, returns `null` if unparseable (button simply doesn't render — same fail-open-to-nothing behavior as the fixture WhatsApp button), otherwise builds:
```
https://wa.me/<number>?text=Hi, I'm <username> and I reached the <stage> of <tournamentTitle>. I'd like to claim my data support.
```
matching the copy given in the request verbatim, `encodeURIComponent`-ed.

`stage` is `'final'` if the player has a `final`-round row, else `'semi-final'` if they have a `semi_final`-round row (a finalist by definition also reached the semifinal in every bracket shape this platform supports, so `final` takes precedence when both exist — the claim message names the furthest stage reached, not every stage).

Dashboard query (new section in `app/dashboard/page.tsx`, own component `components/dashboard/DataSupportPanel.tsx`, following the existing `<section className="mb-10">` pattern): for the logged-in player, join `matches` (`round IN ('semi_final','final')`, `player_a_id/player_b_id = me`) → `tournaments` where `data_support_text IS NOT NULL AND data_support_whatsapp IS NOT NULL`, group by tournament, compute `stage` per tournament as above. Each row shows the tournament title, the `data_support_text` description, and the "Claim Data Support" button. No rows → the section doesn't render at all (same pattern `ReferralPanel` uses when a player has nothing to show).

## 5. Out of scope

- Delivery/fulfilment tracking of any kind — purely a claim-initiation button, per the request.
- Per-placement data support tiers (e.g. different text for semi-finalists vs finalists) beyond the `stage` word already baked into the pre-filled message — one `data_support_text` per tournament describes the whole perk (your example — "1GB for semi-finalists, 2GB for finalists" — is expected to live inside that one free-text field, not as separate structured amounts).
- Any admin-side view of who has claimed — there is no claim record, only the outbound WhatsApp button; nothing is written to the database when a player clicks it.
