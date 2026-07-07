# Admin Match Management — Design (#9 sub-project 4 of 6)

**Route:** `/admin/tournaments/[id]/matches` (new)
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Context

Fourth of the six Admin Dashboard sub-projects. After a bracket is generated (#3), an admin needs
to schedule each match, paste its YouTube stream/replay links, and flip it live. This is
**logistics only** — scores and result confirmation belong to sub-project 5. Builds on the shell
(`requireStaff`) and the tournament/bracket sub-projects. **No DB migration.**

## Role

All actions are `requireStaff` (admin **and** moderator) — match logistics is not a financial
action.

## Page — `app/admin/tournaments/[id]/matches/page.tsx`

Lists all the tournament's matches **grouped by round**: group matches under their group name,
then knockout rounds in canonical order (reuse `ROUND_ORDER`/`ROUND_LABELS` from
`lib/tournaments/bracket.ts`). Each manageable match renders a `MatchRow` (client component).

- Reachable via a **"Matches"** link on `TournamentListRow` (beside Edit/Bracket) and a link on
  the admin bracket page.
- **Bye rows** (`status = 'bye'`, one null player) render **read-only** ("Bye — auto-advances");
  a bye cannot be scheduled or streamed.
- If the tournament has no matches yet, show a "Generate the bracket first" message linking to the
  bracket page.

## Per-match row — `components/admin/MatchRow.tsx` (`"use client"`)

Always-visible inputs with a per-row **Save** button (one `updateMatch` per row — cleaner
validation display than save-on-blur, still fast for bulk scheduling):
- **Schedule** — `<input type="datetime-local">`, clearable.
- **Stream URL** — YouTube link (embedded live on the Match Centre).
- **Replay URL** — YouTube link (shown on the Match Centre after the match).

Plus a **Live toggle** button (`toggleMatchLive`), rendered only when status is `scheduled` or
`live`, labelled "Go live" / "End live".

Field edits (schedule/URLs) are allowed in **any non-bye** status — so an admin can add a replay
URL to a `completed` match. Only the **live toggle** is status-gated.

## Validation — `lib/matches/edit-schema.ts` (zod, unit-tested)

```ts
import { z } from 'zod'
import { parseYouTubeId } from './youtube'

const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
])

// YouTube-only: the Match Centre video section embeds these via parseYouTubeId.
// If this ever accepts non-YouTube (e.g. a Drive link), the Match Centre embed
// must be updated in the same change — otherwise it silently shows "no stream".
const youtubeUrl = z.union([
  z.literal(''),
  z.string().trim().refine((v) => parseYouTubeId(v) !== null, 'Enter a valid YouTube link'),
])

export const matchEditSchema = z.object({
  scheduledAt: localDateTime,
  streamUrl: youtubeUrl,
  replayUrl: youtubeUrl,
})
```

The Match Centre (`app/(public)/matches/[id]/page.tsx`, where `replay_url`/`youtube_stream_url`
feed `VideoEmbed`) gets a matching comment pointing back at `matchEditSchema`, so the
validation↔consumption pair stays in sync.

## Server actions — `lib/matches/admin-actions.ts`

Both `requireStaff`; both **fetch the tournament slug inside the action** (via the `tournaments`
join — never trust the client) to revalidate the public pages.

- `updateMatch(prev, formData)` — parse `matchEditSchema`; load the match with its tournament
  (`id, status, tournament:tournaments(slug)`); if not found, error; update
  `scheduled_at` / `youtube_stream_url` / `replay_url` (empty string → `null`). Then
  `revalidatePath` the matches page, `/matches/[id]`, `/tournaments/[slug]`,
  `/tournaments/[slug]/bracket`, and the admin bracket page.
- `toggleMatchLive(prev, formData)` — load the match with its tournament
  (`status, tournament:tournaments(status, slug)`). Refuse unless the **match** status is
  `scheduled` or `live`. Refuse if the **tournament** status is `completed`
  (`tournaments.status` has no `'cancelled'` value — the enum is
  `draft|registration_open|registration_closed|active|completed` — so `completed` is the operative
  guard; a comment states this). Flip `scheduled ↔ live`. Revalidate as above.

Return a `{ error?: string; success?: boolean }` state.

## Reuse / touched files

- `parseYouTubeId` (`lib/matches/youtube.ts`) — validation.
- `ROUND_ORDER` / `ROUND_LABELS` (`lib/tournaments/bracket.ts`) — round grouping/labels.
- `TournamentListRow.tsx` — add the "Matches" link.
- `app/admin/tournaments/[id]/bracket/page.tsx` — add a "Manage matches" link.
- `app/(public)/matches/[id]/page.tsx` — add the sync comment (no behaviour change).

## Security

- Every mutation is `requireStaff`-gated and re-checks status server-side (match status for the
  toggle, tournament status for the toggle). The slug used for revalidation is read server-side,
  never taken from the client.
- RLS (`matches_staff_update`) independently permits only staff to update matches.

## Testing

Vitest on `lib/matches/edit-schema.ts`:
- valid input (scheduled time + two YouTube links) passes;
- all-empty input passes (fields are clearable);
- a non-YouTube `streamUrl` or `replayUrl` is rejected;
- a malformed `scheduledAt` is rejected.

Actions/page are I/O-bound — exercised via the build and manual admin testing (the seeded DLS
Test Cup provides real matches once its bracket is generated).

## Consistency notes

- Mobile-first; match rows stack their inputs at 375px.
- Do NOT mark roadmap #9 done (sub-project 4 of 6).
- Datetime display remains server-timezone (UTC) per the existing app-wide follow-up in ROADMAP;
  not re-addressed here.
