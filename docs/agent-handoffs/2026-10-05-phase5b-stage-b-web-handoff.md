# Phase 5b Stage B — web build handoff (direct messages API, typing, message requests)

Date: 2026-10-05. Branch `feat/mobile-5b-dm` (worktree `C:\Users\gorok\Videos\sentinelx-p5b-spec`), built on `docs/mobile-phase5b-spec`
(spec + plan). **Not merged to `main`, not pushed** (Checkpoint 1 is the owner's call). Spec:
`docs/superpowers/specs/2026-10-04-mobile-phase5b-direct-messages-design.md`. Plan:
`docs/superpowers/plans/2026-10-04-mobile-phase5b-direct-messages-web.md`.

## What changed in code
- `lib/messages/service.ts` — every DM mutation behind an explicit `{supabase, admin, userId}` context; the Server Actions
  (`lib/messages/actions.ts`) are now thin wrappers with unchanged signatures and error strings (pinned by
  `actions.characterization.test.ts`). `sendClientMessage` is the only entry for client content (own-folder media paths,
  `forwarded` forced false); `sendMessageCore` has no path check so forwarding received media keeps working.
- `lib/messages/read-service.ts` — paged thread list (`box=inbox|requests`, `requestCount`), thread header, message page with
  signed media, reply previews, keyset cursors (`keysetFilterOn` added to `lib/mobile-api/history-cursor.ts`).
- 15 endpoints under `/api/mobile/v1/messages/**` (reads, send/forward idempotent, edit/unsend, read/delivered, block/unblock,
  report, accept/decline); `openapi/mobile-v1.json` regenerated.
- Push: `notifyBoth(..., { data })`; DM push data is `{ url, type, threadId }`.
- Typing: `dm-typing:<threadId>` private broadcast (`lib/messages/typing.ts`, `components/messages/useThreadTyping.ts`).
- Requests: service rules, web inbox "Requests" section, `RequestBanner`, text-only composer while waiting, `dmRequests`
  strings in en/fr/pcm.
- Migrations: `20261005120000_dm_typing_broadcast_policies.sql`, `20261005130000_dm_message_requests.sql`;
  `lib/supabase/types.ts` hand-patched (column `request_state` + 3 function signatures; matches staging).

## Verified (this session, with evidence)
- `npx vitest run`: 348 files / 2704 tests pass. `npx tsc --noEmit`: 0 errors. `npm run lint`: no warnings/errors.
  `npm run build`: exit 0 (needs Supabase env vars; built with the staging URL + dummy keys, since the worktree has no `.env.local`).
- Every task started from a test seen failing; mutation check on the characterization suite caught altered strings.
- **Staging (`sentinelx-staging`, `ofxmoxpvwbemfouaowoa`) — both migrations applied 2026-10-05.** `supabase/tests/dm_typing_policy.sql`
  and `supabase/tests/dm_requests.sql` each ended with the expected `ALL_PASSED_ROLLBACK` against the real database: exemption
  rules (accepted friends yes, pending friend request no, follower no, staff yes), `dm_is_exempt` vs `is_staff()` agree for
  admin/moderator/player, one-message cap, **unsend-then-resend refused**, media/sticker/voice refused while pending, reply
  accepts, decline blocks only the initiator, recipient message reopens, block wins, default `accepted` for existing rows.
- Cap behaviour re-checked on committed rows in staging (second send refused with `request_pending_limit`). Throwaway users and
  rows were removed; zero `zzqa_%@example.invalid` users remain.

## NOT verified
- **Concurrency of the cap.** The cap's correctness under truly simultaneous sends rests on `SELECT … FOR UPDATE` taken before
  the count (READ COMMITTED). I tried to prove it with two parallel SQL sessions, but the tooling ran them back to back (the
  "second" session returned in ~1.0 s with the first already committed), so only the sequential cap was shown. The plan's
  gated vitest harness (`requests.staging.test.ts`) was **not built**: it needs staging service keys I do not have. A real
  two-connection test is still owed (Ruling below).
- Requests/typing **through the HTTP API into PostgREST** (error-message mapping of `request_pending_limit` assumes PostgREST
  returns the raised message in `error.message`, which is standard but unobserved here).
- Web UI in a browser (RequestBanner, composer text-only, Requests link, typing label): no component-test setup exists in the
  repo; covered by tsc/lint/build only.
- Two-client realtime typing; DM push on a device; **production** — migrations not applied there.
- Staging side note: deleting the throwaway auth users removed profiles but left my `dm_threads` row (cascade did not fire);
  removed manually. Worth a look at that FK/cascade chain separately; not part of this work.

## Rulings (what, why, cost if wrong)
1. Typing membership rule in SQL function `dm_typing_topic_allowed`, policies call it — testable, no raw uuid cast on bad topics.
   Cost: one extra function.
2. Request gate trigger locks the thread row on every insert (not only pending) — simplest correct. Cost: minor per-thread
   serialisation of sends.
3. Inbox = accepted OR started-by-viewer; a declined thread the viewer did not start is in neither box. Cost: a declined
   recipient cannot re-find it (they can reopen only by the sender writing again? no — only by the recipient writing, which
   needs the thread; add a "declined" box later if wanted).
4. `requestCount` from a separate query capped at 100, blocked threads excluded. Cost: count tops out at 100.
5. No typing signal while a request is pending (would tell a stranger the recipient is looking).
6. Staging concurrency harness replaced by the (inconclusive) SQL-session check; see NOT verified.
7. Web DM UI stays hard-coded English apart from `dmRequests`. Cost: the rest of the DM screen is not localised.
8. `sendMessageCore` returns `createdAt` (pulled forward from the endpoint task). No behaviour cost.

## Production rollout (owner)
Apply both migrations to production first (`dm_typing_broadcast_policies`, then `dm_message_requests`), then deploy the web
build — **together**. A stricter `dm_can_message`/triggers without this web code would show senders a generic failure at the
cap. Then regenerate `lib/supabase/types.ts` if desired.
