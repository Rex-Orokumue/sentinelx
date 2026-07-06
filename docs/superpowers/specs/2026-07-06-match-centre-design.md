# Match Centre — Design

**Roadmap task:** v1.0 #5 · **Route:** `/matches/[id]`
**Date:** 2026-07-06

## Purpose

The public page for a single match: Player A vs B, the live YouTube stream or replay,
the result, and — for the two participants — a result-submission panel (score +
screenshot + optional recording URL) that feeds admin verification (#9).

## Constraints already in place (verified)

- `matches` — `player_a_id`/`player_b_id` NOT NULL (FKs `matches_player_a_id_fkey`,
  `matches_player_b_id_fkey`), `youtube_stream_url`, `replay_url`, `status`
  ∈ {scheduled,live,completed,disputed,cancelled}.
- `match_results` — `match_id, submitted_by, score_a, score_b (NOT NULL),
  screenshot_url, recording_url, verified (bool), verified_by, verified_at`.
  RLS: `mr_select` (staff or the two players), `mr_player_insert` (`auth.uid() =
  submitted_by` AND submitter is a participant), `mr_staff_update` (staff verify).
- `matches`/`profiles` have `public_read`; the match header is visible to everyone.

## Schema changes (two new migrations, applied by the user)

### `003_match_result_status.sql`
- Add `match_results.status text NOT NULL DEFAULT 'pending'` with
  `CHECK (status IN ('pending','under_review','verified','disputed'))`.
  `status` is the workflow source of truth going forward; the legacy `verified`
  boolean is retained (admin flow #9 will keep it in sync / reconcile). Table is
  currently empty, so no backfill needed.
- Add `UNIQUE (match_id, submitted_by)` — one submission row per participant per
  match; enables a clean `ON CONFLICT` upsert.
- Add RLS policy `mr_own_update_pending`:
  `FOR UPDATE USING (submitted_by = auth.uid() AND status = 'pending')
   WITH CHECK (submitted_by = auth.uid())`.
  This lets a participant edit their own submission **only while `pending`**; once an
  admin opens it (`under_review`) it auto-locks. Coexists (OR) with `mr_staff_update`.

### `004_match_evidence_storage.sql`
- Create a **private** Storage bucket `match-evidence` (public read OFF).
- Object RLS on `storage.objects`:
  - INSERT: authenticated, first path folder = `auth.uid()` —
    `(storage.foldername(name))[1] = auth.uid()::text`.
  - SELECT: object owner or staff (`is_staff()`).
- Object path convention: `{uid}/{matchId}/{timestamp}-{filename}`.

## Signed URLs (important)

Screenshots are private. The page renders them via **server-generated signed URLs**,
created **fresh on every page load** with the service-role admin client, and **never
cached client-side**. Supabase signed-URL TTL defaults to ~1 hour; caching a URL means
a later view (especially the #9 admin review page loaded hours later) gets a dead link.
Signed URLs are generated only after the page confirms the viewer is a participant or
staff. Default TTL used: 3600s (explicit).

## Page (public Server Component) — `app/(public)/matches/[id]/page.tsx`

- Fetch match by id + both players (via the two FK embeds), tournament (title, slug),
  group name. `notFound()` if missing.
- `auth.getUser()` → classify viewer: **participant** (id ∈ {player_a_id, player_b_id}),
  **staff** (via a roles check consistent with existing code), or **spectator**.
- Fetch the **verified** result for the match (if any) — visible to everyone.
- If the viewer is a participant, fetch **their own** `match_results` row (RLS returns
  only permitted rows; we additionally filter `submitted_by = uid`). Never fetch or
  show the opponent's submission to a participant.
- Renders: tournament breadcrumb, **Player A vs B header** (confirmed score if a
  verified result exists, else "vs") + status badge, **video section**, **result
  status**, and the **submission panel** for participants. `generateMetadata()` + OG;
  "Share on WhatsApp".

## Video section — `components/match/VideoEmbed.tsx`

- Pure helper `parseYouTubeId(url)` handling `watch?v=`, `youtu.be/`, `/live/`,
  `/embed/`, with query params; returns `null` on unparseable input. **Tested.**
- Source precedence: `status === 'live'` && `youtube_stream_url` → embed live (LIVE
  badge); else `replay_url` → embed replay; else placeholder ("No stream or replay
  yet"). Presentational iframe (16:9, `rounded-2xl`).

## Result status display (everyone)

- Verified result exists → "✅ Result confirmed" + final score (source of truth;
  bracket already reflects it).
- Participant with their own row:
  - `pending` → editable submission panel, prefilled from the row.
  - `under_review` → locked: "Submitted — under admin review" + their score + signed
    screenshot link.
  - `verified`/`disputed` → status badge (disputed resolution is admin's, #9).
- Spectator with no verified result → just the scheduled/live state.

## Submission panel (participants only) — `components/match/ResultSubmissionForm.tsx`

Client component. Shown when the viewer is a participant, the match is not `cancelled`,
there is no verified result, and their own row is null or `status='pending'`.

- Fields: **Score A**, **Score B** (numeric ≥ 0, required), **screenshot** (file,
  required on first submit; optional on edit if already uploaded), **recording URL**
  (optional; validated as http(s) URL).
- Flow:
  1. If a screenshot file is chosen, upload it to `match-evidence` at
     `{uid}/{matchId}/{timestamp}-{filename}` via the browser Supabase client
     (authenticated; INSERT policy scopes it to the user's folder). Get the object path.
  2. Call Server Action `submitMatchResult(state, formData)` with matchId, scores,
     screenshotPath (new or existing), recordingUrl.
  3. Action re-checks participant + no-verified-result server-side, then **upserts**
     the `match_results` row on `(match_id, submitted_by)` with `status='pending'`.
     RLS (`mr_player_insert` / `mr_own_update_pending`) enforces participant-only and
     the pending-lock server-side.
- On success: `revalidatePath` the match page; the panel re-renders in its new state.

## Modules

- `lib/matches/youtube.ts` — `parseYouTubeId(url): string | null`, `youtubeEmbedUrl(id,
  { autoplay? })`. **Tested.**
- `lib/matches/schema.ts` — zod `submitResultSchema` (scores as ints ≥ 0, recordingUrl
  optional URL). **Tested** (mirrors `lib/auth/schema.ts`).
- `lib/matches/actions.ts` — `submitMatchResult` Server Action (`'use server'`).
- `components/match/VideoEmbed.tsx`, `components/match/ResultSubmissionForm.tsx`.

## Error handling

- Missing match → `notFound()`.
- Invalid scores / bad recording URL → action returns `{ error }` (no write).
- Screenshot upload failure → surfaced client-side before the action runs; no row written.
- Locked row (not `pending`) → action returns a friendly "already under review" error;
  RLS also blocks the update.
- Unparseable YouTube URL → video placeholder, page still renders.

## Testing

Vitest units (pure, no mocking): `parseYouTubeId` (all URL shapes + junk →
null), `youtubeEmbedUrl`, `submitResultSchema` (valid, negative score, non-numeric,
bad URL, missing recording OK). The action, upload, and RLS are verified by
`tsc`+`lint`+`build` and manual testing on the deployed URL with two real accounts.

## Files

**New:**
- `supabase/migrations/003_match_result_status.sql`
- `supabase/migrations/004_match_evidence_storage.sql`
- `app/(public)/matches/[id]/page.tsx`
- `components/match/VideoEmbed.tsx`
- `components/match/ResultSubmissionForm.tsx`
- `lib/matches/youtube.ts`, `lib/matches/schema.ts`, `lib/matches/actions.ts`
- Tests: `lib/matches/youtube.test.ts`, `lib/matches/schema.test.ts`

**Touched:** `lib/supabase/types.ts` regenerated after migrations (adds
`match_results.status`) — or a manual type note if regen isn't run.

## Out of scope (later tasks)

Opponent star-rating (feeds Sentinel Score → v2), admin verify/dispute UI and the
`verified`/`status` reconciliation (#9), full player stats (#10), realtime score
updates. `disputed` shows a badge only; resolution is admin's.
