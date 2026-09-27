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
upcoming events, gallery, community stats. Out of scope: Flutter screens (Stage C), staff/admin
moderation tooling (§7 below — ruled into Phase 8), direct messages, follows (already specced
elsewhere).

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

### Report — **not designed; see §6 open question**

### Weekly challenge progress — **no write endpoint.** `incrementChallenge()` runs server-side only,
as a side effect inside `createPost`/`toggleReaction`(now the reaction PUT/DELETE)/match-confirmation
flows. There is no player-initiated "submit progress" action on web and none is needed here —
confirms the kickoff note's "if it's not pure read" caveat: it isn't a write surface at all, it's
read-only from the client's perspective (§3's `GET /community/challenges`).

## 5. Data model changes needed for Stage B

None. Every endpoint above maps onto existing tables/columns. (Report, if built, would need a new
table — see §6.)

## 6. Moderation ruling — staff actions deferred to Phase 8, not built in Phase 4

Master spec §8.9 says "Moderation: report/delete own; staff pin/announce/delete" in the same
sentence, which reads ambiguously about which phase owns the staff half. §8.24 (Admin, Phase 8)
resolves it explicitly: `createAnnouncement`, `togglePin`, `adminDeletePost`, `adminDeleteStatus`,
`nominateBestPlay`, `confirmBestPlayWinner`, `createChallenge`, `updateChallenge`,
`toggleChallengeActive` are all listed under `/admin/community`, `/admin/community/challenges` as
Phase 8a admin actions with their own admin screens. **Ruling 7: Phase 4 (this phase) builds only
the player-facing half — report (open question below) and delete-own. All staff moderation
(pin/announce/delete-any/challenge CRUD/Best Play nomination-and-confirm) is Phase 8's endpoints and
screens, not this phase's.** This is why §4's delete endpoints are deliberately author-only rather
than "author or staff" even though the RLS policy would allow staff too — building the staff branch
here would pre-empt Phase 8's own auth-level (`'staff'`) design for those actions.

The kickoff note asked to "confirm with the owner" rather than assume — flagging this ruling
explicitly at Checkpoint 1 for that confirmation, even though §8.24's action list makes it a strong,
evidence-based read rather than a guess.

## 7. Realtime plan for mobile

Mirror web's actual scope (Ruling 3), not the master spec's "new-post" phrasing which the web
implementation doesn't itself deliver: subscribe to `post_comments`, `post_reactions` (event `*`,
filtered by `post_id` on a post-detail screen, unfiltered on the feed) and `player_statuses`
(`INSERT`/`DELETE` only, feed screen only) via Supabase Realtime directly from Flutter — same
`postgres_changes` channel approach as web, not a mobile-api concern. On any event, refetch the
affected `GET` endpoint (debounced, matching web's 400ms coalesce) rather than trying to merge raw
realtime rows into local state, for the same reason web's own comment gives: the list is server-computed
(reaction counts, boost state, author profile, frame art) and reconstructing that from a raw row
would duplicate and drift from that logic.

**Open question for the owner:** does mobile need genuine live-new-post push (adding
`community_posts` to the realtime publication), going beyond what web itself does today? Flagging
rather than assuming — this would be new product surface, not parity.

## 8. Rulings summary (all seven, for scanability)

1. Comments are flat, not threaded — no `parent_comment_id` exists in the schema despite master
   spec §8.9's "threaded comments." Endpoints designed for flat comments only.
2. Weekly challenge progress has no player-initiated write path — it's a pure read from the mobile
   client's perspective.
3. "Realtime new-post" doesn't exist on web (`community_posts` isn't in the realtime publication) —
   mobile mirrors web's actual realtime scope (comments/reactions/statuses), flagged as an open
   question rather than silently under- or over-building.
4. Every Community read goes through mobile-api; none stay direct-Supabase (contra the kickoff
   note's tentative "follow the direct-Supabase precedent" framing — that precedent doesn't actually
   exist once Phase 3a is checked).
5. Delete-own endpoints are author-only server-side, not "author or staff," to keep this phase's
   auth boundary simple and leave staff delete to Phase 8's own admin-scoped endpoint.
6. Reactions are redesigned as PUT-to-set / DELETE-to-remove (idempotency-safe) rather than mirroring
   web's single ambiguous toggle action.
7. Staff moderation (pin/announce/delete-any/challenge CRUD/Best Play nominate-confirm) is entirely
   Phase 8's scope, evidenced by master spec §8.24's action list.

Plus the now-resolved Ruling 0 (spec file location — see top of document).

## 9. Open questions for the owner (Checkpoint 1)

1. **Report** — master spec §8.9 lists "report" as in-scope for Phase 4, but the website has
   **no report mechanism for community posts/comments at all** (no table, no action, no UI) — unlike
   DMs, which do have `dm_reports`. Building one now means designing new product surface (a
   `community_post_reports` table, RLS, an admin queue to review it) that doesn't exist on web,
   which cuts against "same backend, not a new one." Recommend: **defer report to a follow-up spec**
   once the web side decides whether/how it wants this feature, rather than inventing it unilaterally
   for mobile-only. Flagging rather than deciding unilaterally since the master spec does name it.
2. **Realtime new-post** (§7) — build genuine live-new-post push (new realtime-publication table),
   or accept web's existing gap (comments/reactions/statuses live, new posts require pull-to-refresh
   or pagination)?
3. **Staff moderation scope** (Ruling 7) — confirm §8.24's action list is authoritative and Phase 4
   should not build any staff-facing moderation UI/endpoints at all.

## 10. Out of scope for this spec

Flutter screens/providers/widgets (Stage C), the actual endpoint implementations and their tests
(Stage B), ARB copy, `openapi.json` regeneration (`npm run openapi`, done at the end of Stage B once
operationIds are wired).
