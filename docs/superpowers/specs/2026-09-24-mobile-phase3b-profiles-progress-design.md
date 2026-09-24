# Mobile Phase 3b — Player Profiles, Follow, Progress & Histories — Design Spec

**Date:** 2026-09-24
**Status:** Approved design → ready for implementation planning
**Repos:** `sentinelx` (web) owns the service extraction + endpoints; `sentinelx_mobile` owns the screens
**Implementer:** Codex (both repos), queued after / alongside 3a; reviewed by Claude
**Part of:** master spec `2026-09-18-flutter-mobile-app-master-design.md` §8.8 (player profile), §8.13 (coins, XP, SX
Score, achievements — display), §13 Phase 3 row. Phase 3 was split into **3a** (rankings/seasons/hall of fame —
`2026-09-23-mobile-phase3a-rankings-seasons-hof-design.md`) and **3b (this spec)**. 3b is deliberately **not split
further** (owner decision 2026-09-24).
**Depends on:** Phase 0B API foundation; Phase 1 shell. Web side is independent of 3a. Flutter side reuses 3a's
`PlayerCard` model and `PlayerAvatar` widget, so **3a's Flutter PR must be merged first** (or 3b's Flutter work starts
from its branch).

---

## 1. Goal, scope, exit criterion

**Goal:** the app has player profiles that match the web profile page, a working Follow, and an owner-only "My progress"
area (XP/tier, SX Score, coins, season standing) with three history lists.

**Exit criterion:** for a sample of 10 players the app profile matches the web profile page on stats, global rank,
current streak, per-category stats, titles, last-10 matches, unlocked achievements **in the web's rarity order**,
follower/following counts, and community posts/gallery. Follow → refresh shows the new state on the app *and* on the web
(same row in `player_follows`), and the target receives exactly one new-follower notification. For one test account, each
history list equals the corresponding DB rows (count and order). **Locked achievements are provably absent** from every
response (§4). Verified on staging data, recorded in the PR description.

**In scope**
- Directory search; public profile; followers / following lists.
- Follow / unfollow (the only write), plus the viewer's own follow sets.
- Owner-only progress: XP + membership tier + progress to next tier, SX Score + sentinel tier, coin balance, DLS season
  standing (rank/points and monthly rank/points, as the web owner card shows).
- **Net-new** owner-only histories: XP events, SX Score events, coin transactions (the web has no page for the first two
  — no code reads `xp_events` or `sx_score_events`; the coin ledger is the wallet page's "recent transactions").
- Behavior-neutral extraction of the profile page, directory page, followers/following pages and the follow actions into
  services.

**Out of scope**
- Friend and Message buttons (owner decision: omit; the profile API carries **no** friendship/messaging state; Phases
  5/6 add them and extend the response).
- Any interaction with community posts (read-only rows; post detail/reactions are Phase 4).
- Editing your own profile (Settings, master spec §8.19), wallet deposit/withdraw (Phase 6), store/equip (Phase 6).
- Changing how rank, streak, stats, rarity or season standing are computed; any query-shape optimization (§3, §7).
- Adding profile links to the 3a rows (rankings/seasons/hall of fame) — a small follow-up edit *after* both phases land.

**No new tables.** Migrations are not expected. If an index is needed for the history queries' cursor pagination it goes
in a UTC-timestamp-named migration and is applied to staging before it is relied on.

---

## 2. Current state (verified 2026-09-24)

- `app/[locale]/(public)/players/[username]/page.tsx` — **614 lines**, ~12 inline queries: `profiles` by username
  (`PROFILE_COLS`: `id, username, display_name, avatar_url, country, bio, created_at, sx_score, sentinel_tier,
  total_matches, wins, losses, goals_scored, goals_conceded, total_titles, xp, membership_tier, deleted_at`),
  `rpc('player_rank', { uname })`, last-10 completed matches (with `.or()` over the player's squads), completed finals
  (titles), category-scoped completed matches, paid-registration count, ranked-player count, the **full achievement
  catalogue**, the player's `player_achievements`, equipped `player_store_items`, a **full scan of every
  `player_achievements` row** (rarity counts), 5 recent posts + 18 gallery images from `community_posts`, and follow
  counts. It also does friendship and messaging lookups (dropped in mobile) and, for the owner only,
  `getCoinBalance(createAdminClient(), id)` and the season-standing card (`getSeasonLeaderboard`/`getMonthlyLeaderboard`
  on the admin client, DLS-only).
- A **deleted account has no public profile**: `loadProfile()` returns null → 404. Tombstones appear only inside lists
  (opponent names, ranking rows, follower lists), never as a profile page.
- Locked achievements are hidden on web only in the *rendered HTML* (`AchievementsGrid` is a server component that shows
  `🔒 Locked`); the data layer still holds every locked name/description/slug. **A JSON API has no such safety net.**
- `lib/follows/actions.ts`: `followPlayer` upserts into `player_follows` with `ignoreDuplicates` on the **caller's
  RLS client**; the `player_follows_own_insert` policy carries a `dm_blocks` check (Postgres `42501` → "You cannot follow
  this player"); a `new_follower` notification (`notifyBoth`, bell + push) fires **only when the upsert really created a
  row**; `canFollow` rejects self-follow. `unfollowPlayer` deletes the row. Both call `revalidatePath` (web-only).
- RLS: `xp_events_read`, `sx_score_events_read` (`auth.uid() = player_id OR is_staff()`), `sx_coin_transactions_read`
  (`auth.uid() = player_id`). Columns — `xp_events(xp, source, reference_id, created_at)`; `sx_score_events(match_id,
  event_type, points_delta, note, created_at)`; `sx_coin_transactions(amount, balance_after, source, reference_id,
  description, created_at)`.
- Vocabularies (for label mapping, all CHECK-constrained): XP `source` ∈ {match_played, match_won,
  tournament_entered, tournament_completed, tournament_placement, achievement_unlocked, daily_login, login_streak,
  community_activity, admin_grant}; SX `event_type` ∈ {match_completed, no_show, rage_quit, dispute_lost,
  rating_received, admin_flag_conduct, admin_flag_cheat}; coin `source` ∈ {match_played, match_won,
  tournament_placement, daily_login, login_streak, achievement_unlocked, store_purchase, community_activity,
  admin_grant, admin_deduct} (later migrations add referral/tournament-discount/wager sources — the plan re-reads the
  live CHECK constraint).
- Membership tiers (`lib/membership/tiers.ts`): recruit 0, guardian 1,000, elite 5,000, sentinel 15,000, legend 50,000 XP.

---

## 3. Web work — two PRs, in this order

### PR 1 — Behavior-neutral extraction (ships first, alone)

Same discipline as 3a §3 PR 1:

1. **Characterization tests before moving anything**, using the 3a harness (`lib/testing/fake-supabase.ts`,
   `serialize-tree.ts`, fixtures — extended with `.or()`, `.not()`, `rpc()` support and profile/achievement/follow/post
   fixtures). Snapshot the rendered element tree **and the query log** for: anonymous visitor, signed-in visitor
   (following / not following / followed-by), **owner** (owner-only cards present), unknown username (404), deleted
   account (404), a player with **both locked and unlocked achievements**, directory with and without `q`, followers and
   following pages.
2. **Record the cost baseline** in the PR description (query count from the query-log snapshot; live timings on
   staging). The full `player_achievements` scan for rarity is a known cost — recorded, **not** changed.
3. **Extract**:
   - `lib/players/service.ts`: `getPlayerProfile(supabase, admin, username, viewer)` returning everything the page
     renders (header, stats, rank, streak, category stats, titles, recent matches, achievement cells, showcase,
     equipped cosmetics, posts, gallery, follow counts, owner-only coin balance and season standing); `searchPlayers`.
   - `lib/follows/service.ts`: `followPlayer(client, followerId, targetId, deps)` /
     `unfollowPlayer(...)` returning `{ ok: true, created: boolean } | { ok: false, code: 'self' | 'blocked' | 'error' }`;
     `notifyBoth` fires inside the service only when `created`. `lib/follows/actions.ts` becomes a thin wrapper that
     adds `revalidatePath` and maps codes to today's exact error strings.
   - Followers/following list loaders (`lib/follows/query.ts` already holds the pieces).
4. **Nothing else changes** — no query merged, dropped, reordered, cached or re-limited; no fix for the rarity scan.
   Tests green, snapshots unchanged, then merge.

### PR 2 — Mobile endpoints

All via `defineEndpoint()`, envelope/versioning per `2026-09-18-mobile-api-v1-conventions.md`; never hand-write routes.
Public endpoints use `createAnonClient()` (RLS as anon) and **do not read the bearer**.

| Endpoint | Auth | Returns | Cache |
|---|---|---|---|
| `GET /players?q=` | public | matching players (card + tier + sx score), web's 60-row cap and ilike escaping | `s-maxage=60` |
| `GET /players/{username}` | public | profile (§4), 404 for unknown **and** deleted | `s-maxage=60` |
| `GET /players/{username}/followers`, `/following` | public | list entries (`id, username, displayName, avatarUrl, membershipTier`), same ordering/paging as the web pages | `s-maxage=60` |
| `GET /me/follows` | user | `{ followingIds: string[], followerIds: string[] }` — the viewer's own sets | `no-store` |
| `PUT /players/{username}/follow` | user, **`idempotent: true`** | `{ following: true, created: boolean }` | `no-store` |
| `DELETE /players/{username}/follow` | user | `{ following: false }` (naturally idempotent) | `no-store` |
| `GET /me/progress` | user | §5 | `no-store` |
| `GET /me/xp-events`, `/me/sx-score-events`, `/me/coin-transactions` | user | cursor-paged own history (§6) | `no-store` |

Rules:
- **Viewer state stays out of public responses.** "Following" and "Follows you" are derived on the app from
  `GET /me/follows` (profile page *and* the two list screens). Public endpoints are byte-identical for everyone; a test
  asserts identical bodies with and without an `Authorization` header.
- **Follow runs on `ctx.userClient`** (RLS), never the service role: the `dm_blocks` policy is the block mechanism and
  must keep applying. Map: self-follow → 400 `cannot_follow_self`; `42501` → 403 `follow_blocked`; unknown/deleted
  username → 404. The new-follower notification fires only when `created` (guaranteed by the shared service), and an
  idempotent replay (same `Idempotency-Key`) returns the stored response and fires **nothing**.
- **History endpoints run on `ctx.userClient`** *and* filter `.eq('player_id', ctx.userId)` — RLS is the structural
  backstop, the filter is belt-and-braces. Never the service role.
- `GET /me/progress` needs the service role only for `getCoinBalance` (existing helper, id from `ctx.userId`) and the
  season-standing read (same admin-client path as 3a §3). Both are called out in §7.
- Run `npm run openapi` **last**, commit `openapi/mobile-v1.json`; `npm run lint` and `npm run build` before pushing.

---

## 4. The public profile response and the locked-achievement guarantee

`GET /players/{username}` returns exactly these top-level keys (strict zod schema, exact-key-set tests at every level):

- `player`: `id, username, displayName, avatarUrl, frameUrl, country, bio, createdAt, sxScore, sentinelTier,
  membershipTier` (**no** `xp` unless the web shows it publicly — the plan verifies which `XPProgressPanel` fields the
  page renders for non-owners and mirrors that exactly), plus any equipped cosmetics the web header renders.
- `stats`: `totalMatches, wins, losses, goalsScored, goalsConceded, totalTitles, tournamentsPlayed, currentStreak,
  rank, totalRankedPlayers, followerCount, followingCount`, `categoryStats[]`.
- `titles[]`, `recentMatches[]` (≤10, `opponentName` may be a tombstone label),
- `achievements`: `{ total: number, unlockedCount: number, unlocked: [{ slug, name, description, category,
  unlockedAt, unlockCount }], showcase: [slug…] }` — `unlocked` in the web's rarity order (`topShowcase` logic reused),
  `showcase` = the top-3 subset.
- `posts[]` (≤5: `id, content, postType, createdAt`), `gallery[]` (≤18: `id, imageUrl`).

**Locked achievements are never sent as objects.** Only `total` and `unlockedCount` are sent for them, so a client can
render "7/30" and 23 lock icons without learning any locked name, description, slug or category. Enforcement:
1. The mapper builds the unlocked list from `AchievementCell[]` by filtering `unlocked === true` **before** mapping and
   never spreads a cell.
2. A test loads the **entire achievement catalogue** and asserts that, for a player with a mix of locked/unlocked, the
   serialized response body contains **no** locked achievement's `name`, `description` or `slug` (substring check over
   the full catalogue minus the unlocked set).
3. Strict schema rejects any extra key.

Other privacy rules: only the allow-listed `profiles` columns (CLAUDE.md rule 10, never `select('*')`); private columns
(`phone, whatsapp_number, notification_prefs, referred_by, deletion_requested_at`) never appear; the coin balance,
monthly standing, `xp` value (unless public on web) and every history are **only** on `/me/*`.

---

## 5. `GET /me/progress`

Owner-only, `auth: 'user'`, `no-store`:
`{ xp, membershipTier, tierProgress: { current, next, xpIntoTier, xpForNextTier } | null (max tier), sxScore,
sentinelTier, coinBalance, seasonStanding: { seasonName, rank, points, pointsAtRankSixteen, monthlyRank, monthlyPoints }
| null (no active season) }`. Tier math reuses `TIER_XP_THRESHOLDS`/`computeTier` (one implementation — no Dart copy;
the server sends the progress numbers). Season standing is **DLS-only, exactly like the web card** (a per-game standing
is a separate follow-up on web too).

---

## 6. History endpoints (net-new)

`GET /me/xp-events?cursor=`, `/me/sx-score-events?cursor=`, `/me/coin-transactions?cursor=` → `{ items, nextCursor }`,
**20 per page, newest first**, cursor = opaque base64 of `(created_at, id)` (keyset, stable under inserts), invalid
cursor → 400.

| List | Item fields | Deliberately **not** returned |
|---|---|---|
| XP | `id, xp, source, createdAt` | `reference_id` |
| SX Score | `id, eventType, pointsDelta, matchId (nullable), createdAt` | **`note`** — free text that can carry staff remarks on flag events; the web never shows it |
| Coins | `id, amount, balanceAfter, source, description, createdAt` | `reference_id` (`description` is already shown to the owner on the web wallet) |

The API returns **raw codes** (`source`, `eventType`); the app maps each to a localized label with a generic fallback
for any unknown code, so a new DB value never breaks or blanks a screen. Strict schemas + exact-key-set tests
(`note` must be absent even if the fixture row carries it).

---

## 7. Flutter work

New feature folders `lib/features/{players,progress}/`; Riverpod providers beside each; hand-written `ApiClient` methods
listed in `usedOperations` (contract-tested against `api/openapi.json`, a copy of the web repo's
`openapi/mobile-v1.json`); new models in a new file (`lib/core/api/players_models.dart`), not `models.dart`.

- **Directory**: search box (debounced), result rows → profile.
- **Profile**: header (avatar + frame, name, tier badges, country, bio), stats grid, rank/streak, category stats, titles,
  recent matches, achievements grid (`unlockedCount/total`, locked shown as anonymous lock tiles), showcase strip,
  posts and gallery (read-only), followers/following counts → lists. Follow button: state from `GET /me/follows`;
  **optimistic** toggle; PUT sends a fresh `Idempotency-Key` per tap (reused on retry of the same tap); rolls back and
  shows the mapped error on 403/400; signed-out tap → `/login`. No Friend/Message buttons. Own profile shows no Follow
  button. Public deleted accounts → the API's 404 renders a neutral "player not found" screen.
- **My progress** (`/account/progress`): tier/XP panel with progress bar, SX Score + sentinel tier, coin balance, season
  standing card; three history screens with infinite scroll on `nextCursor`, empty/error/retry states, code→label maps
  in ARB.
- **Routes** (added inside their existing shell branches; `resolveWebLink()` maps `/players/{username}` and the two list
  paths): `/players`, `/players/:username`, `/players/:username/followers`, `/players/:username/following`,
  `/account/progress`, `/account/progress/xp`, `/account/progress/score`, `/account/progress/coins`. Entry: a "My
  progress" tile on the Account tab and a "Players" search entry on Home; **do not edit the temporary tournaments slice**.
- **Copy:** never hard-coded in widgets. Web has partial profile copy in `messages/en.json` — the plan checks which keys
  exist and uses `tool/gen_l10n_from_web.dart` for those; anything absent is added directly to `app_en.arb`. Regenerate,
  commit output, never edit `gen/*`.
- `flutter analyze` and `flutter test` clean before every commit; widget tests cover empty/loading/error, follow
  optimistic-rollback, locked-tile rendering, cursor paging, and the signed-out follow redirect.

---

## 8. Parallel-work rules

Codex is (or soon will be) building 3a in the same repos and Claude is building Phase 2b. Same rules as 3a §5: own
git worktrees; prefer new files; hotspots are `openapi/mobile-v1.json` (regenerate last after rebasing),
`lib/mobile-api/endpoints/index.ts` (append-only), `lib/supabase/types.ts`, and on mobile `lib/core/api/api_client.dart`
(append-only), `api/openapi.json` (re-copy), `lib/router/app_router.dart` (new routes only), ARB/l10n (regenerate).
The 3a test harness (`lib/testing/*`) is **reused, not forked** — if 3a has not merged, base 3b PR 1 on 3a's PR 1 branch.

---

## 9. Verification

1. PR 1: characterization snapshots (tree + query log) green before *and* after the move; cost baseline recorded; no
   snapshot modified after it is first recorded; web pages visually unchanged.
2. PR 2: endpoint tests — strict shapes, exact key sets, **locked-achievement catalogue test**, public-endpoint
   byte-identity with/without bearer, follow (created / duplicate / self / blocked / unknown / replay-no-second-
   notification), history cursor paging and ordering, `note` absent, own-rows-only; `npm run lint`, `npm run build`,
   `npm run openapi` clean.
3. Flutter: `flutter analyze` / `flutter test` clean; device run at 375px against staging.
4. **Exit check** per §1: 10 profiles side by side, a follow round-trip verified in the DB and on web, three histories
   compared to DB rows.
5. Curl check on staging that no response body contains `whatsapp|phone|notification_prefs|referred|deletion` and that
   `/players/*` bodies contain no locked achievement text.

## 10. Risks

- **Locked-achievement leakage** — the guarantee is structural (§4) but only as good as the catalogue test; it is the
  first test written for the mapper.
- **Admin-client paths in `/me/progress`** (coin balance, season standing) have no RLS backstop — explicit selects,
  mapped output, strict schema, key-set tests, and only `ctx.userId` as the id.
- **Rarity scan cost** — every profile view scans all `player_achievements` rows; grows with players × unlocks. Cached
  (`s-maxage=60`) and baselined; a lighter query (e.g. an aggregate view) is a separate, provable, later decision.
- **Notification double-fire** — a retried follow must not re-notify; covered by the shared `created` flag and the
  idempotency-replay test.
- **History pagination correctness** — keyset on `(created_at, id)`; ties on identical timestamps must not skip or
  duplicate rows (test with equal timestamps).
- **Merge friction with 3a/2b** — §8.

## 11. Open items for the plan to resolve by reading code (none block the design)

- Exact `ProfileMatch`/titles/category-stat response shapes (mirror `ProfileView`, `ProfileMatch`, `ProfileTitle`).
- Which `XPProgressPanel`/`ProfileHeader` fields the web renders to non-owners (decides whether `xp` is public).
- Followers/following page size and ordering (read `followers/page.tsx`; parity, not redesign).
- The live CHECK constraints for `sx_coin_transactions.source` and `xp_events.source` (later migrations extended them) to
  seed the app's label maps.
- Whether an index on `(player_id, created_at desc, id desc)` is needed for the three history tables at current scale.
