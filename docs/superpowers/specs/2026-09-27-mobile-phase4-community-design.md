# Mobile Phase 4 — Community — API Design Spec

## Ruling 0 — spec location (resolved)

This spec was first drafted at `sentinelx_mobile/docs/superpowers/specs/...` because the
investigation subagent's task instructions that produced the first draft explicitly (and
mistakenly) forbade writing into this repo. CLAUDE.md ("each phase needing endpoints gets its
own spec in the **web** repo first"), AGENTS.md, and the Phase 3a precedent
(`docs/superpowers/specs/2026-09-23-mobile-phase3a-rankings-seasons-hof-design.md`, committed on
this same `docs/mobile-phase1-phase2a-specs` branch) all agree this belongs here. Corrected before
Checkpoint 1: this is now the canonical copy; the mobile-repo copy has been deleted.

---

## 1. Goal, scope, exit criterion

Design the `/api/mobile/v1/*` surface for Sentinel X mobile's Community feature (master spec
§8.9), grounded in the website's actual live implementation (Server Actions + Supabase, not the
older design docs' intent, where they've drifted). Covers: feed, post detail, compose, reactions,
comments, boost, statuses/stories, weekly challenges, Best Play of the Week voting, top members,
upcoming events, gallery, community stats, and report (submit half; §6). Out of scope: Flutter
screens (Stage C), staff/admin moderation tooling incl. the report review queue (§6 — ruled into
Phase 8), direct messages, follows (already specced elsewhere).

Exit criterion for this spec: every write action Phase 4 needs has a method/path/auth/idempotency/
request/response/error decision; every read has an explicit mobile-api-vs-direct-Supabase call with
a reason.

## 2. Current state (verified 2026-09-27, read from `sentinelx` @ `origin/main`)

The website's Community feature is Server-Actions-based, not `app/api/*` routes — there is nothing
in the mobile-api surface for Community today (`lib/mobile-api/endpoints/` has no `community.ts`).
Ground truth was read directly from `lib/community/*.ts` and `supabase/migrations/*`, cross-checked
against the three design docs named in the kickoff note.

**Tables (current schema, not the docs' original v3.6 design — that was migrated away):**

| Table | RLS | Notes |
|---|---|---|
| `community_posts` | `community_posts_read` (`is_deleted = false`, public — confirmed live in this migration, superseding an earlier short-lived `auth.uid() IS NOT NULL` policy from the v3.6 schema); insert: `auth.uid() = author_id`; delete: author-only via `community_posts_player_delete` (`WITH CHECK (is_deleted = true)` — a soft-delete-only UPDATE, not a hard DELETE) — **plus** `community_posts_staff_manage` for staff (pin/announce/delete/boost-adjacent admin ops) | `post_type`: `manual`\|`match_result`\|`achievement`\|`announcement`. `is_pinned`, `boosted_until` (24 h from `boostPost`, `BOOST_DURATION_MS`), `reference_id` (match id for `match_result` posts, author-less), `is_deleted`. Legacy `image_url` column still holds the *first* image (every existing reader depends on this); additional images go to `community_post_images`. |
| `community_post_images` | select: signed-in; insert/delete: gated to the post's own author via a subquery | `display_order`, up to 4 more (5 total, `MAX_POST_IMAGES`) |
| `post_reactions` | read: public; `post_reactions_manage_own`: owner only | `UNIQUE(post_id, player_id)`; `reaction` ∈ `{fire, crown, strong, wow}` (`REACTIONS` in `lib/community/schema.ts`) — **flat set, not the emoji count itself**, i.e. one row per (post, player) |
| `post_comments` | read: `is_deleted = false`, public; insert: `auth.uid() = author_id`; `post_comments_player_delete` (soft-delete, own only) + `post_comments_staff_manage` | **No `parent_comment_id` column — comments are flat, not threaded.** See Ruling 1. `content` ≤ 280 chars. |
| `player_statuses` | requires sign-in to read (confirmed in CLAUDE.md) | 24 h via `expires_at`; `CHECK` constraints require `image_url IS NOT NULL OR caption <> ''`, caption ≤ 200 |
| `status_views` | insert-your-own via upsert `ignoreDuplicates` on `UNIQUE(status_id, viewer_id)` | drives "seen" ring state + one-time "X viewed your status" notification |
| `community_challenges` | read: public | seeded rows, `challenge_type` ∈ `matches_played\|matches_won\|post_created\|reactions_given`; admin-editable since migration `061_community_challenges_admin.sql` |
| `player_challenge_progress` | read: public | `UNIQUE(player_id, challenge_id, week_start)`; **written only by server-side `incrementChallenge()`, never directly by a player action** — see Ruling 2 |
| `best_play_nominations` | read: public | staff-created (Phase 8 tooling), `week_start`, `is_winner` |
| `best_play_votes` | read: public; `best_play_votes_insert_own` | `UNIQUE(player_id, week_start)` — **one vote per player per week, not per nomination** (a retry that names the *same* nomination should be idempotent-safe; naming a *different* one is a genuine "already voted" business error, not a retry) |

**Realtime:** only `post_comments`, `post_reactions`, `player_statuses`, `status_views` are added
to the `supabase_realtime` publication. **`community_posts` itself is not** — the web's own
`CommunityRealtime.tsx` does not subscribe to it, so "new post appears live" does not actually
exist on web today despite master spec §8.9 saying "Realtime new-post/reaction updates." See
Ruling 3.

**Coin spend (boost):** `boostPost` (`lib/community/post-actions.ts`) charges `BOOST_COST_COINS = 200`
via `recordCoinTransaction`, then sets `boosted_until = now + 24h` (`BOOST_DURATION_MS`), with an
explicit refund-on-write-failure rollback. One active boost per player at a time, manual posts only,
author-only. This is exactly the "coin-spend + non-reversible-if-double-charged" shape that
`wager.ts`/`rating.ts`/`squads.ts` already solve with `idempotent: true` — same pattern applies.

**Idempotency mechanism** (`lib/mobile-api/idempotency.ts` + `define-endpoint.ts`): a `defineEndpoint`
declares `idempotent: true`; the framework then requires an `Idempotency-Key` header, claims a row in
`api_idempotency_keys` keyed on `(key, user_id, route)`, runs the handler once, and stores/replays the
exact response on any retry with the same key (Stripe-style — same key always replays the same stored
outcome, success or error). No per-endpoint idempotency code is needed beyond setting the flag and
having the handler be safe to run once. Observed usage isn't limited to money: `postMatchRating`
(1–5 star rating, no coins) and `postSquads` (squad creation) both use it too — the bar is "a retried
duplicate would create unwanted duplicate state or a duplicate side-effect (notification)," not
"only when coins move." `followPlayer` (PUT, idempotent) vs `unfollowPlayer` (DELETE, "naturally
idempotent," no key) is the cleanest existing precedent for a toggle-like action split into a
settable PUT + a naturally-idempotent DELETE — reused directly below for reactions.

## 3. Read-path decision

**Ruling 4:** every Community read goes through `/api/mobile/v1/*`, none stay direct-Supabase.

The kickoff note floated "prior phases used direct-Supabase reads for other confirmed-public
tables — follow that precedent unless there's a reason not to." Checking that precedent
(Phase 3a, `2026-09-23-mobile-phase3a-rankings-seasons-hof-design.md` §2) shows the opposite: even
though rankings/HOF read from confirmed-public tables (`profiles`, `matches`), Phase 3a's own plan
was to *extract the existing inline TypeScript aggregation into mobile-api endpoints*, not read
those tables directly from Flutter. The only genuinely-direct-Supabase reads left in this codebase
are the temporary `lib/data`/`lib/features/tournaments` slice, which CLAUDE.md itself marks for
wholesale replacement. There is no live precedent for a *new* Phase reading directly.

Every Community list in `lib/community/*-query.ts` is TypeScript-computed in the CLAUDE.md sense —
reaction-count aggregation, boost-liveness, muted-by-viewer, frame-URL resolution, comment counts,
voting-window math, week-boundary math, viewer-vs-friend fan-out for status notifications, and
several do multi-table joins with post-fetch client-side array-vs-single normalization. None of
this is a plain RLS-safe row read. Two additional reasons beyond CLAUDE.md's rule: (a) several
reads join `profiles` for author display fields, and CLAUDE.md's S1–S3 findings say not to widen
reliance on direct `profiles` reads; (b) `player_statuses` requires sign-in and its viewer list
must be scoped server-side to the status's own author — that authorization check belongs server-side,
not in an RLS policy the client could get wrong assumptions about.

| Mobile need | Endpoint | Why mobile-api |
|---|---|---|
| Feed (pinned + paginated posts) | `GET /community/feed` | Joins reactions/comments/author/match-result/frame art; boost-liveness and ordering logic (`isBoostLive`) must match exactly or the badge and the sort order disagree (see the comment in `boost.ts` about the 3-week-stale-boost bug this already caused once) |
| Post detail | `GET /community/posts/{id}` | Same `PostView` shape as feed |
| Comments for a post | `GET /community/posts/{id}/comments` | Author profile join; `is_deleted` filter; ordering |
| Weekly challenges widget | `GET /community/challenges` | Two-table merge + `currentWeekStart()` WAT-timezone math + fixed display ordering |
| Best Play banner | `GET /community/best-play` | Voting-window-open math, vote tally, "my vote" resolution, post/author join |
| Status rings (tray) | `GET /community/statuses` | `expires_at` filtering, viewed-state per viewer, author profile join, ring grouping |
| Status viewer list | `GET /community/statuses/{id}/viewers` | **Must be server-enforced to the status's own author** — not a client-trusted check |
| Top members | `GET /community/top-members` | Ranking/aggregation (`fetchTopCommunityMembers`) |
| Upcoming events | `GET /community/upcoming-events` | Filters/joins tournaments data (`fetchUpcomingCommunityEvents`) |
| Gallery | `GET /community/gallery` | Author join + caption truncation |
| Community stats bar | `GET /community/stats` | Cross-table counts + client-side distinct-country dedup |

All of the above are `auth: 'public'` (optionalAuth) except the challenges widget and the status
viewer list, which are `auth: 'user'` (challenges progress is meaningless for a guest — the web
function already returns `null` for a null viewer; the viewer list is privacy-sensitive and
author-only).

## 4. Write endpoints

All under `/community/*`, `auth: 'user'` unless noted. Error envelope/status codes follow the
existing `ApiError`/`Errors` convention (`lib/mobile-api/errors.ts`) — codes below are the
`errorCode` string, mapped to an HTTP status the same way `wager.ts`'s `STATUS`/`MESSAGE` records do.

### `POST /community/posts` — create a post
- Body: `{ content: string (≤500, trimmed), imageUrls?: string[] (≤5, extras beyond the first go to `community_post_images`) }`
- Response: `{ id: string }`
- **Idempotent: yes.** A retried duplicate would (a) create a second visible public post, and
  (b) could double-increment the `post_created` weekly challenge if the increment weren't itself
  guarded — `incrementChallenge`'s `rewarded_at` guard only protects the *reward*, not the raw
  progress counter, so a duplicate POST would inflate progress by 2 for one real post. Matches the
  `postMatchRating`/`postSquads` bar (duplicate-state risk, not just money).
- Errors: `validation` (400, empty content *and* no image — mirrors web's "Write something or add a
  screenshot first"), `content_too_long` folds into the shared zod validation path.
- Server-side note: `post_type` is always `manual` for this endpoint — `match_result`/`achievement`/
  `announcement` posts are system/staff-generated elsewhere and are out of scope here.

### `DELETE /community/posts/{id}` — delete own post
- Response: `{ success: true }`
- **Idempotent:** naturally (soft delete; repeat call is a no-op), no key required — same class as
  `unfollowPlayer`.
- **Authorization: author-only, enforced server-side, not "author or staff."** See Ruling 5 — staff
  delete is Phase 8's endpoint, not this one, even though the underlying RLS policy
  (`community_posts_staff_manage`) would technically permit it.
- Errors: `not_found` (404) if missing/already deleted, `forbidden` (403) if not the author.

### `POST /community/posts/{id}/boost` — boost for 200 coins
- Body: none
- Response: `{ success: true }`
- **Idempotent: yes — mandatory**, exactly as the kickoff note requires. Mirrors `wager.ts`'s
  service-extraction shape: pull the actual logic out of `boostPost` (`lib/community/post-actions.ts`)
  into a `performBoostPost(userClient, admin, userId, postId)`-style service function (like
  `performPlaceWager`), so the endpoint handler stays a thin wrapper and the refund-on-failure logic
  isn't duplicated.
- Errors: `not_found` (404, missing/not-yours-or-not-manual — web collapses these into one message,
  keep that), `already_boosted` (409), `active_boost_exists` (409, one boost per player), `insufficient_coins` (400).

### `PUT /community/posts/{id}/reaction` — set my reaction
- Body: `{ reaction: 'fire' | 'crown' | 'strong' | 'wow' }`
- Response: `{ reaction: ReactionType }`
- **Idempotent: yes.** Deviation from web (Ruling 6): the website's `toggleReaction` is one
  Server Action that flips between insert/update/delete based on prior state, which is *not*
  naturally idempotent — replaying it changes the outcome (fire→crown→fire→... on each retry). This
  spec instead splits it like `followPlayer`/`unfollowPlayer`: `PUT .../reaction` sets the caller's
  reaction to exactly the given value (a genuine set-idempotent PUT — replaying it is a no-op once
  applied) and `DELETE .../reaction` removes it. The client's "tap the same emoji to remove it" UX
  still works — it just calls DELETE instead of PUT when the tapped reaction matches the current one.
  This also fixes a real risk in the web version: a retried insert-branch call would double-fire
  `notifyBoth`/`incrementChallenge('reactions_given')` today; the idempotency key prevents that outright.
- Errors: `not_found` (404, post missing/deleted).

### `DELETE /community/posts/{id}/reaction` — remove my reaction
- Response: `{ success: true }`
- **Idempotent:** naturally, no key required.

### `POST /community/posts/{id}/comments` — create a comment
- Body: `{ content: string (≤280, trimmed, non-empty) }`
- Response: `{ id: string }`
- **Idempotent: yes** — a retried duplicate comment would fan out a duplicate `post_comment`
  notification to the post's author/other thread participants/staff (announcement posts), same
  risk class as reactions.
- Errors: `validation` (400, empty/too long), `not_found` (404, post missing).
- **No threading in this endpoint** — see Ruling 1. `content` is a flat top-level comment only;
  there is no reply-to-comment concept in the current schema.

### `DELETE /community/comments/{id}` — delete own comment
- Response: `{ success: true }`
- **Idempotent:** naturally, no key required.
- **Authorization: author-only**, same Ruling 5 as post delete (staff delete stays in Phase 8).

### `POST /community/statuses` — post a 24h story
- Body: `{ imageUrl?: string, caption?: string }` (at least one required, mirrors
  `player_statuses_has_content` CHECK; caption ≤ 200)
- Response: `{ id: string }`
- **Idempotent: yes** — a retried duplicate creates a second visible story; also avoids a possible
  double friend-notification race (the "notify only on first live status" check in `postStatus`
  reads `liveCount` *after* its own insert, so two near-simultaneous real inserts could both observe
  count 1 and both notify — the same failure mode `runIdempotent`'s claim-row approach exists to prevent).
- Errors: `validation` (400).

### `DELETE /community/statuses/{id}` — delete own status
- Response: `{ success: true }`
- **Idempotent:** naturally, no key required. Author-only (RLS already restricts this; server-side
  check kept for a friendly 403/404 instead of a silent no-op, mirroring web).

### `POST /community/statuses/{id}/view` — mark a story viewed
- Body: none
- Response: `{ success: true }`
- **Idempotent:** naturally — the underlying `status_views` upsert already uses
  `onConflict: 'status_id,viewer_id', ignoreDuplicates: true`; a repeat call is a genuine no-op by
  construction, no `Idempotency-Key` machinery needed. Best-effort like web: never let a failure
  here surface as an error the caller has to handle (swallow server-side, always return success —
  matches `recordStatusView`'s "must never break playback" comment).

### `POST /community/best-play/{nominationId}/vote` — vote for Best Play
- Body: none
- Response: `{ success: true }`
- **Idempotent: yes.** The DB's `UNIQUE(player_id, week_start)` constraint (not
  `UNIQUE(player_id, nomination_id)`) means a genuine retry of *this exact vote* should replay as
  success, but a second distinct vote-for-a-different-nomination call in the same week is a real
  "already voted" business error, not a retry — the `Idempotency-Key` mechanism handles this
  correctly by construction, since a fresh business action mints a fresh key (mobile spec §6.3 step
  6) while a genuine client retry reuses the same one.
- Errors: `not_found` (404, nomination missing/not this week), `voting_closed` (409, outside the
  Fri 9am–Sun 9pm WAT window — `isVotingWindowOpen()`), `already_voted` (409, distinct nomination
  already voted this week — maps the `23505` unique-violation path).

### `POST /community/posts/{id}/report` — report a post
- Body: `{ reasonCode: 'spam' | 'harassment' | 'hate_speech' | 'nudity_or_sexual_content' | 'violence' | 'misinformation' | 'other', note?: string (≤500) }`
- Response: `{ success: true }`
- **Idempotent: yes**, via the `Idempotency-Key` mechanism for a genuine retry, *and* a DB-level dedupe
  (`community_content_reports_post_dedupe` partial unique index on `(reporter_id, post_id) WHERE
  comment_id IS NULL`) so the same reporter can only have one open report per post — a second distinct
  report attempt (different key, same reporter+post) is the `already_reported` business error, not a
  silent no-op, mirroring the Best Play vote endpoint's retry-vs-new-action split (§4 above).
- Errors: `not_found` (404, post missing or `is_deleted`), `already_reported` (409).

### `POST /community/comments/{id}/report` — report a comment
- Body: same shape as the post report. `post_id` is resolved server-side from the comment (never
  trusted from the client) and stored alongside `comment_id` so a staff reviewer sees both.
- Response / idempotency / errors: same pattern as the post report, deduped via
  `community_content_reports_comment_dedupe` (`(reporter_id, comment_id) WHERE comment_id IS NOT NULL`).

See §6 for the full report design (new table, RLS, and why this ships in Phase 4 while the staff review
queue that consumes it ships in Phase 8).

### Weekly challenge progress — **no write endpoint.** `incrementChallenge()` runs server-side only,
as a side effect inside `createPost`/`toggleReaction`(now the reaction PUT/DELETE)/match-confirmation
flows. There is no player-initiated "submit progress" action on web and none is needed here —
confirms the kickoff note's "if it's not pure read" caveat: it isn't a write surface at all, it's
read-only from the client's perspective (§3's `GET /community/challenges`).

## 5. Data model changes needed for Stage B

**One new table, `community_content_reports`**, built now rather than deferred (owner decision,
2026-09-28 — see §6). Every other endpoint above maps onto existing tables/columns.

```sql
CREATE TABLE public.community_content_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id     uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  comment_id  uuid        REFERENCES public.post_comments(id) ON DELETE CASCADE,
  reason_code text        NOT NULL CHECK (reason_code IN (
                            'spam', 'harassment', 'hate_speech',
                            'nudity_or_sexual_content', 'violence', 'misinformation', 'other')),
  reason_note text        CHECK (char_length(reason_note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution  text        CHECK (resolution IN ('no_action', 'content_removed', 'user_warned', 'user_banned'))
);

-- Dedupe: one open report per reporter per post, and separately per reporter per comment
-- (partial indexes, not a single UNIQUE(...), because plain UNIQUE treats every NULL
-- comment_id as distinct and would not actually dedupe post-level reports).
CREATE UNIQUE INDEX community_content_reports_post_dedupe
  ON public.community_content_reports (reporter_id, post_id) WHERE comment_id IS NULL;
CREATE UNIQUE INDEX community_content_reports_comment_dedupe
  ON public.community_content_reports (reporter_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX community_content_reports_open_idx
  ON public.community_content_reports (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.community_content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "community_content_reports_reporter_or_staff_read" ON public.community_content_reports
  FOR SELECT USING (reporter_id = auth.uid() OR public.is_staff());
CREATE POLICY "community_content_reports_own_insert" ON public.community_content_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "community_content_reports_staff_update" ON public.community_content_reports
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());
```

Modeled directly on `dm_reports` (`20260909204325_direct_messages.sql`) — one table for both post- and
comment-level reports (not two), `resolved_at`/`resolved_by` for the open-queue pattern, staff-only
update. Two additions over the `dm_reports` shape, both because Community reports need to support a
real moderation workflow from day one rather than a bare "resolved or not" flag: a `reason_code`
taxonomy (so the Phase 8 queue can triage/filter by category instead of free-text-only) and a
`resolution` enum (so closing a report records *what* staff did, not just *that* they looked at it —
`dm_reports` only has `resolved_at`, which this table deliberately doesn't repeat).

**Realtime publication:** `community_posts` is added to `supabase_realtime` (see §7) — this is also a
Stage B migration, same shape as `081_community_realtime.sql`.

## 6. Moderation ruling — staff actions confirmed deferred to Phase 8; report fully designed now

**Decided by the owner at Checkpoint 1 (2026-09-28): confirmed as written.** Master spec §8.9 says
"Moderation: report/delete own; staff pin/announce/delete" in the same sentence, which reads
ambiguously about which phase owns the staff half. §8.24 (Admin, Phase 8) resolves it explicitly:
`createAnnouncement`, `togglePin`, `adminDeletePost`, `adminDeleteStatus`, `nominateBestPlay`,
`confirmBestPlayWinner`, `createChallenge`, `updateChallenge`, `toggleChallengeActive` are all listed
under `/admin/community`, `/admin/community/challenges` as Phase 8a admin actions with their own admin
screens. **Ruling 7: Phase 4 (this phase) builds only the player-facing half — report and delete-own.
All staff moderation (pin/announce/delete-any/challenge CRUD/Best Play nomination-and-confirm,
*including the report review queue itself*) is Phase 8's endpoints and screens, not this phase's.**
This is why §4's delete endpoints are deliberately author-only rather than "author or staff" even
though the RLS policy would allow staff too — building the staff branch here would pre-empt Phase 8's
own auth-level (`'staff'`) design for those actions.

**Report is not deferred as a *design* — only its staff-facing half is deferred as a *build*.** The
original draft of this spec recommended punting Report to "a follow-up spec, someday" because web has
no report mechanism for Community at all. The owner rejected that framing as a standing project rule:
nothing here ships as a half-built v1 with a vague "later" — everything gets fully designed up front,
even when one half's *build* genuinely belongs to a later phase for architectural reasons (auth-level
separation, same as the rest of this ruling). So: the `community_content_reports` table (§5), its RLS,
and the two player-facing submit endpoints (§4) are designed and **built in Phase 4**. The table is
already shaped for the Phase 8 review queue it will feed (`reason_code` taxonomy, `resolution` enum,
`resolved_at`/`resolved_by`) so that phase isn't redesigning the schema later — it just adds
`GET /admin/community/reports` and the resolve action against a table that already exists. Phase 8's
own spec still owns designing that queue's endpoints/UI in detail; this spec only guarantees the data
it will read is already correct and complete.

## 7. Realtime plan for mobile

**Decided by the owner at Checkpoint 1 (2026-09-28): mobile goes beyond web's current parity gap, and
web is brought up to the same bar rather than mobile inventing a mobile-only mechanism.** Subscribe to
`post_comments`, `post_reactions` (event `*`, filtered by `post_id` on a post-detail screen, unfiltered
on the feed), `player_statuses` (`INSERT`/`DELETE` only, feed screen only), **and now `community_posts`
(`INSERT` only, feed screen only)** via Supabase Realtime directly from Flutter — same
`postgres_changes` channel approach as web, not a mobile-api concern. On any event, refetch the
affected `GET` endpoint (debounced, matching web's 400ms coalesce) rather than trying to merge raw
realtime rows into local state, for the same reason web's own comment gives: the list is server-computed
(reaction counts, boost state, author profile, frame art) and reconstructing that from a raw row would
duplicate and drift from that logic.

**Ruling 3 (revised):** `community_posts` is added to the `supabase_realtime` publication in Stage B
(§5), with the identical justification `081_community_realtime.sql` already used for
`post_comments`/`post_reactions` — the table is already public-read (`community_posts_read`,
`is_deleted = false`), so publishing it for realtime exposes nothing a visitor couldn't already select;
it's a capability addition, not a new access grant. This is a **platform-level** migration, not a
mobile-only trick: web's own feed (`app/[locale]/community/page.tsx` or wherever it currently
polls/reloads for new posts) can subscribe to the same publication in a future web change without
another migration. This spec only builds the mobile consumer; bringing web's own UI onto the same feed
subscription is out of scope here and left for web's own team/backlog to pick up, but the backend
capability is shared from day one rather than mobile-siloed.

## 8. Rulings summary (all eight, for scanability)

1. Comments are flat, not threaded — no `parent_comment_id` exists in the schema despite master
   spec §8.9's "threaded comments." Endpoints designed for flat comments only.
2. Weekly challenge progress has no player-initiated write path — it's a pure read from the mobile
   client's perspective.
3. **(Revised 2026-09-28.)** Mobile builds genuine live-new-post push: `community_posts` is added to
   the `supabase_realtime` publication (a platform-level capability, not mobile-only — web can adopt
   the same subscription later without another migration), going beyond web's current gap rather than
   mirroring it.
4. Every Community read goes through mobile-api; none stay direct-Supabase (contra the kickoff
   note's tentative "follow the direct-Supabase precedent" framing — that precedent doesn't actually
   exist once Phase 3a is checked).
5. Delete-own endpoints are author-only server-side, not "author or staff," to keep this phase's
   auth boundary simple and leave staff delete to Phase 8's own admin-scoped endpoint.
6. Reactions are redesigned as PUT-to-set / DELETE-to-remove (idempotency-safe) rather than mirroring
   web's single ambiguous toggle action.
7. Staff moderation (pin/announce/delete-any/challenge CRUD/Best Play nominate-confirm, and the report
   review queue itself) is entirely Phase 8's scope, evidenced by master spec §8.24's action list —
   **confirmed by the owner 2026-09-28.**
8. **(New 2026-09-28.)** Report is fully designed and its player-facing half fully built in Phase 4
   (table, RLS, submit endpoints) rather than deferred to an unscoped "follow-up spec" — only the
   staff review queue that consumes it is a Phase 8 *build* item, per the project's standing
   full-build-now rule (§6).

Plus the now-resolved Ruling 0 (spec file location — see top of document).

## 9. Open questions — resolved by the owner at Checkpoint 1 (2026-09-28)

1. **Report** — the original draft here recommended deferring report to an unscoped "follow-up spec."
   **Owner's decision: reject the defer-the-design framing.** This is not a v1/v2 project — report is
   fully designed now (§5, §6) and its player-facing half (submit endpoints, §4) is built in Phase 4.
   Only the staff review queue is a Phase 8 *build* item, and only because that's a real phase/auth
   boundary (staff-only tooling), not because the design was left unfinished.
2. **Realtime new-post** (§7) — **owner's decision: build it, and go beyond web's current parity gap.**
   `community_posts` joins the realtime publication as a platform-level capability (§7's revised
   Ruling 3); mobile is the first consumer, web can adopt it later without another migration.
3. **Staff moderation scope** (Ruling 7) — **confirmed.** §8.24's action list is authoritative; Phase 4
   builds no staff-facing moderation UI/endpoints (including no report-review queue — that's Phase 8's,
   consuming the table this phase already ships).

## 10. Out of scope for this spec

Flutter screens/providers/widgets (Stage C), the actual endpoint implementations and their tests
(Stage B), ARB copy, `openapi.json` regeneration (`npm run openapi`, done at the end of Stage B once
operationIds are wired).
