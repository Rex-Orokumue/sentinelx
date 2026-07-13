# Match Recording Submission via WhatsApp (#30) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** nothing new — extends the existing `components/match/ResultSubmissionForm.tsx`, reuses the `wa.me` builder pattern (`lib/dashboard/fixtures.ts`, established in #25/#29) and the `NEXT_PUBLIC_*`-with-fallback convention already used for `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL` (`app/layout.tsx`).

---

## 1. Goal

The platform has no native video hosting (per CLAUDE.md) and result submission today only accepts a screenshot plus an optional "Recording URL" text field (YouTube/Drive link the player pastes in themselves). Add a "Submit recording via WhatsApp" button to the result submission form that opens WhatsApp with a pre-filled message to the admin, so a player can send the actual video file directly instead of needing to host it and paste a link. This is additive — the screenshot stays required, the URL field stays as-is, this is a third, optional path alongside both.

## 2. Config — one new env var

`NEXT_PUBLIC_ADMIN_WHATSAPP` (Vercel env var, not hardcoded, per the request). Read with the same fallback convention every other `NEXT_PUBLIC_*` value in this codebase uses:
```ts
const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? null
```
Unlike `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL` (which falls back to `'#'` because it's a plain link with no dynamic text), this one needs to build a `wa.me` URL with `toWhatsAppNumber`, so an unset/unparseable value should hide the button entirely rather than link to `'#'` — same "fail open to nothing" behavior as `buildOpponentWhatsAppUrl` already has when a number doesn't parse.

## 3. Button — `components/match/ResultSubmissionForm.tsx`

New pure helper alongside the existing ones in `lib/dashboard/fixtures.ts` (or a new small `lib/matches/recording-whatsapp.ts` if keeping match-specific helpers out of the dashboard module is preferred — implementation-plan detail):
```ts
export function buildRecordingWhatsAppUrl(args: {
  adminWhatsapp: string | null
  username: string
  tournamentTitle: string
  playerAName: string
  playerBName: string
}): string | null
```
Returns `null` when `adminWhatsapp` is unset or unparseable via `toWhatsAppNumber` (button doesn't render). Otherwise:
```
https://wa.me/<number>?text=Hi, I'm <username> submitting my recording for <tournamentTitle> - <playerAName> vs <playerBName>.
```
matching the copy given in the request verbatim, `encodeURIComponent`-ed.

`ResultSubmissionForm` needs two new props it doesn't receive today — `username` (the logged-in player's own, for the message) and `tournamentTitle` (the match page already has this via `m.tournaments.title` but doesn't currently pass it down). Both are plumbed from `app/(public)/matches/[id]/page.tsx`'s existing query (`profiles.username` for the current user is already resolved elsewhere on that page for `isParticipant`; `m.tournaments.title` is already selected). `playerAName`/`playerBName` are already props on the form today — no new query needed for those.

The button renders as a `<a target="_blank" rel="noopener noreferrer">` styled consistently with the existing WhatsApp buttons elsewhere (e.g. the Match Room "Coordinate on WhatsApp" button from #26), placed directly below the "Recording URL" field, with a short caption ("Prefer to send the full video? Message it to us on WhatsApp.") so it reads as a third option, not a replacement for the two above it.

## 4. Out of scope

- Any server-side tracking of whether a player clicked the button or sent a recording — same "claim/submission-initiation only, no delivery tracking" model as #29's data support button. The screenshot + optional URL are still the only fields written to `match_results`.
- Changing the screenshot requirement — it stays mandatory exactly as it is today; this button doesn't relax that.
- A parallel button on the friendly-match result form (`app/dashboard/friendlies/[id]/page.tsx` already has its own WhatsApp "coordinate" button for the Match Room, unrelated to this) — out of scope unless requested separately, since friendly-match evidence review is a much lower-stakes, informal flow than tournament results.
