# Mobile Phase 5c — Guide quests and support chatbot (design)

Status: **owner review comments incorporated (2026-10-05, rev 2)**; approval relayed as pasted text, to be
confirmed before `writing-plans`. No plan and no code yet.
Mobile master spec §8.20 is the product source (quests and chatbot are one bullet each; line 412 holds the
`/guide/*` endpoint row, line 357 the `/me/summary` quests mention). Ground truth below was read from
`origin/main` on 2026-10-05. This spec is the web-side contract and the mobile design.

## 1. Goal and scope

Full-parity guidance in the Flutter app, shaped for mobile:

- **Guide quests:** the 3-step Battle Ready checklist with deep links, the explicit badge claim, and a quest
  card on Home.
- **First-run coach marks:** a same-page spotlight tour of the real UI, dismissible and replayable.
- **Signed-out visitor tour** (the app lets signed-out users browse; auth is not forced).
- **Support chatbot:** streamed replies, history for signed-in players, FAQ-only chat for signed-out users,
  account-aware answers for signed-in players, equipped mascot skin.

Owner decisions (2026-10-05): (a) privacy model **minimized snapshot + 30-day history + Clear chat + purge on
account deletion**, applied to web as well; (b) **streamed** replies over a raw route; (c) all three extra
surfaces are in scope: coach marks, signed-out tour with FAQ chat, quest card on Home.

Out of scope: any new notification type, admin transcript review, RAG/embeddings, multiple chat threads,
a quest system beyond Battle Ready (the contract is a list so more can be added without a new endpoint).

## 2. Ground truth (web, `origin/main`)

| Fact | Where |
|---|---|
| Quest = 3 steps: profile complete (`username` and `avatar_url` set), first paid registration, `profiles.total_matches >= 1`. Free and fee-waived registrations are stored `payment_status='paid'`, so they count. `total_matches` only increments after admin confirms a match. | `lib/guide/quest-status.ts`, `actions.ts`, `register-service.ts` |
| Claim re-verifies server-side, inserts `player_achievements` (UNIQUE player+achievement), then awards XP, coins and `notifyBoth` as **separate calls** (insert first, award after). Slug `battle_ready`, 100 XP, 50 coins. | `lib/guide/actions.ts`, migration 069 |
| Mobile API has **no** quest/guide route; `/home` and `/me/summary` carry no quests. | `lib/mobile-api` grep |
| Chat route `POST /api/chat`: Groq `openai/gpt-oss-120b`, call 1 non-streamed (decides on tool), call 2 streamed only after the tool. Plain-text body, no framing, so a mid-stream failure is indistinguishable from a short answer. No `max_tokens`, no upstream timeout. | `app/api/chat/route.ts` |
| History is client-owned, resent each turn; server keeps only `role` user/assistant string entries, last 40. Message length is not capped. | `sanitize-history.ts` |
| One tool `get_account_snapshot`, **no arguments**, run with the session's `player_id`. Returns matches (with opponent **display names**), registrations, wallet, coins, SX score/tier, withdrawals, KYC status, friendlies (opponent display names, stake), unread count. Executed once regardless of how many calls the model made. | `lib/chat/tools.ts`, `account-snapshot.ts` |
| Rate limit 15 messages / 10 min per `player:<id>` or `anon:<cookie>`: **count, then insert, two statements** (concurrent requests can both pass). No per-day or global cap; anonymous identity is a client-controlled cookie. | `lib/chat/rate-limit.ts` |
| `chat_messages` (player, role, content) is written by service role after each turn; read via RLS self-select (last 50, no age limit); "Clear chat" is a **direct client-side delete** via the `chat_messages_self_delete` policy. | migration 070, `ChatTab.tsx` |
| `anonymise_account` does **not** delete `chat_messages` or the player's `chat_rate_limit_events` (the `profiles` row survives, so `ON DELETE CASCADE` never fires). History outlives account deletion. | `anonymise_account` (latest: `20260909204325_direct_messages.sql`) |
| System prompt is English only. Guardrails: no betting advice, no cross-player data, no actions. | `lib/chat/system-prompt.ts` |
| Mascot skin is `profiles.equipped_bubble_skin` (3 slugs -> `/coin-items/bubble-mascot-*.webp`, default `/mascot/mascot-bubble.png`). `/me` does not return it. | `lib/store/cosmetics.ts`, `lib/nav/session.ts` |
| `defineEndpoint` only produces `{ data }` JSON envelopes (response parsed through zod). No streaming helper exists. | `lib/mobile-api/define-endpoint.ts` |
| Mobile: signed-out users reach the shell; Home is standalone; tabs are Compete/Watch/Community/Trade/Account. Dio-based `ApiClient`, JSON only. | `auth_redirect.dart`, `api_client.dart` |

## 3. Design

### 3.1 Service layer

`lib/guide/service.ts` and `lib/chat/service.ts` take an explicit context `{ admin, userId }` (conventions §7.1).
The existing server actions and route and the new endpoints call the same code. Characterization tests are
written before moving code. Behavior of web actions does not change except where 3.2 and 3.5 say so.

### 3.2 Guide endpoints (`lib/mobile-api/endpoints/guide.ts`)

| Operation | Method and path | Response | Notes |
|---|---|---|---|
| `getGuideQuests` | `GET /guide/quests` (`auth: user`) | `{ quests: Quest[] }` | `Quest` = `{ id: 'battle_ready', steps: Step[], doneCount, totalCount, allComplete, claimed, reward: { xp, coins } }`. `Step` = `{ key, done, target }`. `key` in `profile_complete \| first_tournament_entered \| first_match_completed`; `target` in `edit_profile \| tournaments \| matches` (an **enum, never a URL**; the app maps it to a route, unknown values degrade to no link). `reward` read from the `achievements` row, not hard-coded. |
| `claimGuideBadge` | `POST /guide/badge` (`auth: user`, body `{ quest: 'battle_ready' }`) | `{ claimed: true, alreadyClaimed: boolean, xp, coins }` | Re-verifies status server-side. Naturally idempotent on the UNIQUE row (a retry returns `alreadyClaimed: true`, never a second reward). Error `quest_incomplete` (409). |

The Home quest card reads `getGuideQuests` through its own provider; `/home` and `/me/summary` are **not**
changed (avoids coupling a cheap summary to the quest queries; the master spec line 357 mention is superseded).
`GET /me` gains additive `equippedBubbleSkin` (slug) and `bubbleSkinUrl` (relative path, same convention as
`frameUrl`); old clients ignore them.

**Claim atomicity (Stage B must resolve with evidence).** Today the achievement row is inserted before XP and
coins are awarded, so a failure between them leaves a badge with no reward and a retry that returns
"already claimed". XP and coin awards have **no idempotency by source** today (no unique key, no
`ON CONFLICT`), so "award first against a unique source key" is not free: it needs a new ledger constraint.
A single-transaction `SECURITY DEFINER` function is only safe if `awardXP` and `recordCoinTransaction` are thin
wrappers over SQL; otherwise it re-implements level logic in SQL and the two copies can drift. **Stage B reads
both functions first and states in its plan which route it took and why.** Fixing this changes the web action
too; it is the only behavior change in the guide service.

### 3.3 Chat endpoints (`lib/mobile-api/endpoints/chat.ts`)

| Operation | Method and path | Request | Response | Notes |
|---|---|---|---|---|
| `postChatMessage` | `POST /chat/messages` (`auth: public`, bearer optional) | `{ messages: {role,content}[], clientTurnId: uuid, locale: 'en'\|'fr'\|'pcm' }` | **stream** (3.4) | Raw streaming route. Signed-in: tool and persistence. Signed-out: FAQ only, nothing stored. |
| `getChatHistory` | `GET /chat/history?before&limit` (`auth: user`) | — | `{ messages: {id,role,content,createdAt}[], nextBefore }` | Oldest-first window within the last 30 days, default 40, max 100. |
| `clearChatHistory` | `DELETE /chat/history` (`auth: user`) | — | `{ ok }` | Naturally idempotent. Web "Clear chat" moves onto the same service; the `chat_messages_self_delete` policy is dropped in a later cleanup migration (section 5), not alongside this change. |

Input limits (both routes): each message content ≤ 1,000 chars, history ≤ 20 messages and ≤ 8,000 chars total
(web is 40 and uncapped); violations are `validation_failed`. Each upstream call has an abort timeout (20 s)
and is aborted when the client disconnects (`req.signal`). The route sets `maxDuration` of at least 45 s (worst
case is two 20 s calls); Stage B confirms the project's plan allows it.

**Output cap on a reasoning model.** `gpt-oss-120b` is assumed to count reasoning tokens toward
`max_tokens`, so a small cap can leave little or no visible reply (to confirm on staging). The route sets
`reasoning_effort: 'low'`, a generous cap (initial value 2,000, tuned on staging), and treats
`finish_reason = 'length'` as an explicit terminal `error` event (`chat_truncated`), never as a short answer.

**Authentication.** Bearer is optional: no `Authorization` header means signed-out. A bearer that is **present
but invalid or expired returns 401** (not a silent downgrade to anonymous), so the app's refresh flow runs and a
signed-in player never loses account answers and history without an explanation. `defineStreamEndpoint`
therefore does not reuse `optionalAuth`'s swallow-errors behavior.

Error codes, all with the standard envelope and sent **before** the stream starts: `chat_rate_limited` (429, with
a `Retry-After` header and `fields.retryAfterSeconds`), `chat_unavailable` (503: anonymous daily cap reached or
provider key missing), `chat_upstream` (502), `validation_failed`. Mobile branches on `code`, never `status`,
and never shows server text.

### 3.4 Streaming

A new `defineStreamEndpoint` in `lib/mobile-api/define-stream-endpoint.ts` extracts and shares the version gate,
auth, body parsing and error envelope from `defineEndpoint` (so there is one implementation), and returns a
`Response` with a `ReadableStream` instead of a zod-parsed `{ data }`. It registers an OpenAPI operation with an
`application/x-ndjson` 200 response whose event union is documented, so `route-files.test` and mobile's
`api_contract_test` still cover it. Headers: `cache-control: no-store`, `x-accel-buffering: no`,
`export const runtime = 'nodejs'`, explicit `maxDuration`.

Wire format, one JSON object per line (a failure mid-stream is now distinguishable from a short answer):

```
{"t":"status","state":"checking_account"}     tool running (signed-in only)
{"t":"delta","text":"..."}                    reply text
{"t":"actions","items":["wallet","tournaments"]}   validated destinations (3.6)
{"t":"done","persisted":true}                 terminal, success
{"t":"error","code":"chat_upstream"}          terminal, failure after the stream began
```

Exactly one terminal event; the stream always ends after it. A client that sees EOF without a terminal event
treats the turn as interrupted. The web's two-phase flow is kept (call 1 non-streamed, call 2 streamed after a tool);
a no-tool answer is flushed as one `delta`. Persistence
(user and assistant rows, signed-in only) happens once, at `done`, and only if the stream completed;
`clientTurnId` is stored with a unique `(player_id, client_turn_id)` index so a retry after an interrupted turn
cannot create a duplicate. A client abort persists nothing.

### 3.5 Privacy model (owner decision 1, plus what it implies)

**What the model receives.**
- `get_account_snapshot` becomes `get_account_info({ sections: Section[] })` where `Section` is the enum
  `matches \| registrations \| wallet \| withdrawals \| kyc \| friendlies \| score \| notifications`. The server
  runs **only** the requested sections, validates the enum (unknown values dropped), caps the list at 8 and
  **never reads an id from the model**. A question about fixtures sends no wallet data; this is real minimization,
  where the web's single no-argument tool sends everything every time. (Deviation from the web's "no arguments"
  wording; the security property that matters, "the id never comes from the model", is kept. See open question 1.)
- Opponent and friend **display names are dropped**; the snapshot uses the public `username` only. Squad names
  are user-controlled text and are included only as sanitized strings (control and bidi characters stripped, 40
  chars max). Timestamps are ISO dates. Email, phone, WhatsApp number and address are never included (as today).
- Because accuracy now depends on the tool description, it states which section answers which question
  (`matches`: next match, opponent, schedule; `wallet`: cash balance and SX coins; `withdrawals`: payout status;
  `kyc`: payout-account verification; `registrations`: tournament entries and payment; `friendlies`: friendly
  matches and stakes; `score`: SX Score and tier; `notifications`: unread count). **Eval before ship:** about ten
  scripted questions (e.g. "when is my next match", "how much is in my wallet", "where is my withdrawal") run
  against real Groq on staging with the expected sections asserted; a failing eval blocks Stage D sign-off.
- The tool result is passed as a JSON object and the system prompt states that its contents are data, never
  instructions. Names inside it are a prompt-injection channel; the defense is that the model has no write tool
  and no tool that takes an id, so the worst outcome is a misleading sentence in the player's own chat.

**What is stored.** Signed-in history only, 30 days, deleted by `clearChatHistory`, deleted by `anonymise_account`
(new `DELETE FROM chat_messages WHERE player_id = p_id` and the same for `chat_rate_limit_events` with the subject
key `player:<id>`; the migration must `CREATE OR REPLACE` the **latest** definition of the function, found by
reading the whole migration chain, not the DM migration alone). A daily `pg_cron` job prunes rows older than 30
days. **Existing web rows older than 30 days are deleted on the first run: a visible web behavior change** (see
open question 5). Signed-out chat is held in app memory only and discarded on sign-in and on app exit.

**Third party.** Groq receives the signed-in player's chat text and the requested sections. Per the owner's
review: by default Groq does not retain inference data but may log inputs and outputs for up to 30 days for
troubleshooting and abuse checks, and its terms bar training on them. **The owner enables Zero Data Retention in
the Groq console (Data Controls) before the Privacy line goes live.** The Privacy page line names Groq, says
processing happens outside Nigeria, and says ZDR is on (retained data, if any, sits in US storage; region
pinning is enterprise-only). Players are mostly minors, so a qualified person must check the cross-border and
children's-data rules; this spec makes no legal claim. The chat UI tells users that chats are kept 30 days. No
device identifiers or IPs are sent to Groq. (Terms were relayed by the owner; I have not independently verified
them.)

### 3.6 Output is untrusted; destination chips

- Reply text is plain text end to end: the app renders it as `Text`, never HTML or Markdown, auto-links nothing,
  strips control and bidi-override characters, and never executes or interprets it. The server also strips them.
- The model may not choose a route or call. It may write inline tokens `{{go:<destination>}}` where
  `<destination>` is an enum (`tournaments`, `matches`, `wallet`, `profile`, `notifications`, `rules`, `safety`,
  `help`). The server's stream filter (a small state machine that buffers partial `{{` across chunk boundaries)
  removes **every** `{{...}}` from the text and emits an `actions` event containing only validated enum values.
  The app maps each enum to a fixed in-app route through a table; unknown values are dropped. Chips are shown
  below the reply as buttons. See open question 2 (this can be cut without affecting the rest).

### 3.7 Rate limiting, anonymous identity, cost

- Replace check-then-insert with a Postgres function `chat_rate_limit_hit(subject, limit, window)` that takes
  `pg_advisory_xact_lock(hashtext(subject))`, counts, inserts only if allowed, and returns `{ allowed,
  retry_after_seconds }`. One round trip, race-free. The web route adopts it.
- Limits: signed-in **15 / 10 min and 120 / day** per player. Signed-out **6 / 10 min per bucket and 150 / day
  per IP bucket** (mobile carriers put many unrelated users behind one IP, so a low per-IP cap would lock out
  innocent players; the global ceiling is the real spend control). Two env-configurable ceilings: a **global
  signed-out daily ceiling, default 500 turns**, and a **total daily ceiling covering signed-in turns too**
  (default set in the plan from the owner's budget). At the owner's figures (about $0.15 / $0.60 per million
  input / output tokens, assumed ~6k input tokens, so roughly $0.0015 per turn) 500 signed-out turns a day is
  about $22 a month at worst; the real prompt size must be measured on staging. Over the signed-out ceiling:
  `chat_unavailable` and the app tells the user to sign in; over the total ceiling: `chat_unavailable` for
  everyone.
- Signed-out identity on mobile has no cookie. Buckets are `ip:<hmac(ip)>` (the hard bound) and `device:<id>`
  from an `X-Device-Id` header the app generates once (spoofable, so it only adds a bucket, never raises a
  limit). Subject keys are HMAC-hashed with a server pepper so raw IPs of minors are not stored.
  `chat_rate_limit_events` keeps its 24 h prune; the daily counter uses a small `chat_usage_daily` table.
- A retry of the same `clientTurnId` is rate-limited again (accepted; simpler than refunds).

### 3.8 Locale

`locale` selects an addendum to the system prompt ("reply in French"). Server accepts `en|fr|pcm`; mobile sends
the app locale (en or fr). Unknown values fall back to `en`. The FAQ block stays English.

### 3.9 Mobile structure

- **Routes** (standalone, pushed, outside the shell, so the five tabs stay fixed): `/guide` (quest card, visitor
  tour when signed out, "replay tour", links) and `/guide/chat`. Entry point: a mascot button in the app bar next
  to the bell and messages icons (wearing the equipped skin when signed in; default mascot, bundled in assets,
  when signed out). Home shows a **quest card** (hidden once claimed and acknowledged) that opens `/guide`.
  `resolveWebLink` needs no change (the web has no guide route; claim notifications link to `/dashboard`,
  already mapped to Home). Tests assert in-app `/guide` paths return `null` from the redirect.
- **Providers** keyed on `viewerIdProvider` (a refreshed session must not refetch): `guideQuestsProvider`,
  `chatThreadProvider`. Claim refreshes the quest provider and the XP/coin providers.
- **Quest refresh:** on `/guide` open, on Home resume, and after a registration or payment confirms or a match
  is confirmed via the existing bell/push events. No polling.
- **Chat state machine** (one notifier per viewer; one in-flight turn at a time): `idle -> sending ->
  streaming -> done | interrupted | failed`. The user bubble is optimistic; the assistant bubble grows on `delta`.
  `interrupted` (EOF without terminal, app paused, or connectivity lost) offers Retry, which resends the **same**
  `clientTurnId`. A failed optimistic turn reverts only its own fields; mutators no-op when `!ref.mounted`.
  A keep-alive is held while a turn is in flight (leaving the screen does not lose the reply), released on a
  terminal event or after 90 s. Flutter stops frames while paused, so pause handling lives in the lifecycle
  source, not a rebuild.
- **Streaming client:** `ApiClient.postChatMessage` returns `Stream<ChatEvent>` using Dio `ResponseType.stream`,
  line-buffered NDJSON, tolerant parser (one bad line is skipped, an unknown `t` is ignored, nothing throws).
  Listed in `ApiClient.usedOperations` and covered by the contract test.
- **Coach marks:** pure client feature. `GlobalKey` targets on the tab bar items, Home cards, app-bar bell,
  messages and guide buttons; same-page only; an overlay with cutout, mascot callout, Next/Skip, back button
  dismisses. Shown once per signed-in viewer on first Home visit after onboarding completes (and once for
  signed-out first launch); the seen flag is local per viewer id (a reinstall replays it; no server state).
  "Replay tour" lives on `/guide`. TalkBack: each step is announced, the overlay is a `Semantics` scope, and
  reduced-motion disables the pulse.
- **Copy:** ARB only, en + fr with identical key sets; guide and chat strings live in `app_en.arb` (no web
  `messages` namespace for the chat chrome). Quest step labels come from ARB keyed on `key`; an unknown key from a
  newer server renders a generic label. American spelling. `SxColors` only. Mobile-first at 375 px.
- **Errors:** every `ApiException.code` maps to ARB copy: `chat_rate_limited` (with the wait time),
  `chat_unavailable`, `chat_upstream`, `quest_incomplete`, network; unknown codes use a generic message.

## 4. Rulings (cost if wrong)

1. **Raw streaming route with a documented NDJSON union**, not plain text and not whole-reply JSON. Cost: a new
   helper in the API layer and a streaming parser on mobile. Plain text would repeat the web's inability to
   tell a failed stream from a short answer.
2. **Chat and guide logic moved to shared services**, web actions refactored onto them. Cost: web regression
   risk, mitigated by characterization tests first.
3. **Section-scoped tool instead of one all-data tool.** Cost: a slightly less reliable tool call on the model
   (an enum argument); worst case it requests a section it did not need. Benefit: data minimization is real.
4. **30-day history with purge applied to web too** (one retention policy, not two). Cost: a visible web change
   and one migration; reverting means dropping the cron job.
5. **Atomic DB rate limiter** replacing the web's check-then-insert. Cost: one function; benefit: the limit
   actually holds under concurrency and mobile retries.
6. **Anonymous chat is allowed with a global cap.** Cost: it can be starved by abuse (it fails closed to
   "sign in"); an uncapped anonymous LLM endpoint is a spend risk the web has today.
7. **Coach marks and seen-flag are local only.** Cost: a reinstall replays the tour; benefit: no new server
   state and no new write path.
8. **Quest card reads `/guide/quests`, not `/home`.** Cost: one more request on Home; benefit: `/home` stays
   cheap and the contract stays small.

## 5. Stages (each stops at a checkpoint, as in 5a/5b)

- **Stage A0 (ships first, on its own):** a standalone migration that updates `anonymise_account` to delete
  `chat_messages` and the player's `chat_rate_limit_events` (reading the latest definition across the whole
  migration chain), **and purges chat rows of accounts already anonymised** (`profiles.deleted_at IS NOT NULL`
  or the `deleted_` username marker). This is a live erasure bug and does not wait for Stage B.
- **Stage A1 (prerequisite for the quest):** strip EXIF/GPS from avatars before upload, on mobile
  (`sanitizeJpeg`, which lives in the mobile repo, not the web repo) and in the web `ProfileForm`
  (re-encode in the browser before upload). Avatars already uploaded still carry EXIF and need a separate
  **one-off scrub** (its own task with a dry-run count first).
- **Stage B (web):** migration (`chat_messages` + `client_turn_id`, `chat_usage_daily`, rate-limit function,
  prune cron), guide service + endpoints, chat service + `defineStreamEndpoint` + endpoints, web actions/route
  refactored onto `DELETE /chat/history`, `/me` additive fields, OpenAPI regenerated. Staging first, then
  production, migration and web code together. The `chat_messages_self_delete` policy is **not** dropped here:
  it is dropped in a later cleanup migration once the web code using the new path is live, so web "Clear chat"
  never breaks in between.
- **Stage C (mobile guide):** quest models/provider/screen/card, claim, visitor tour, coach marks, app-bar entry.
- **Stage D (mobile chat):** streaming client, notifier, screen, history, clear, chips, errors.
- Each stage that needs a contract copies `openapi/mobile-v1.json` to `api/openapi.json`.

## 6. Tests

Web (vitest): quest status and claim (incomplete -> `quest_incomplete`, double claim -> one reward, claim retry
after a simulated failure does not double-award); characterization of existing guide and chat actions; each
endpoint's auth, validation and error codes; history pagination, 30-day window, clear; section tool (unknown
section dropped, no id accepted from the model, only requested sections queried, partial failure degrades);
sanitize (roles, length caps, control/bidi stripping); stream filter (`{{go:x}}` split across chunks, nested and
unterminated tokens, unknown destination dropped, tokens never reach `delta`); stream terminal-event invariant
(exactly one, after any failure); abort persists nothing; `clientTurnId` dedupe; rate limiter under parallel
calls (advisory lock) against staging; anonymous global cap; `anonymise_account` removes chat rows (staging);
prune job; OpenAPI snapshot including the NDJSON operation.

Mobile (flutter test): quest/chat models and tolerant parsing; each `ApiClient` method (`usedOperations`); NDJSON
parser (split lines, bad line skipped, unknown `t`, EOF without terminal -> interrupted); chat state machine with
fake_async (no real sleeps): stream, interrupt, retry reuses `clientTurnId`, one turn at a time, keep-alive
released, revert scope; reply rendered as plain text (a `<b>` or a Markdown link is shown literally, bidi stripped);
chips mapped only through the fixed table; quest provider keyed on viewer (refreshed session does not refetch);
claim then refresh; Home card hides when claimed; coach marks: once per viewer, skip, back, replay, same-page
only; routes not swallowed by `resolveWebLink`; ARB parity; bearer header on authenticated requests, none on
signed-out chat.

## 7. Not verifiable in this phase

Real Groq behavior (tool selection with the enum argument, `gpt-oss-120b` availability, latency), streaming
through Vercel under real network conditions, Android lifecycle behavior mid-stream, TalkBack on the overlay,
the global cap under real abuse, and the iOS equivalents (Phase 10). These go on the device-pass checklist.

## 8. Owner decisions (resolved 2026-10-05)

1. Section-scoped tool: **yes**, with a described-sections tool description and a staging eval (3.5).
2. Destination chips: **keep**.
3. Signed-out ceiling: **500 / day**, plus a total ceiling for all traffic, both env-configurable (3.7).
4. Groq: owner enables **Zero Data Retention**; Privacy line names Groq, says processing is outside Nigeria and
   that ZDR is on; a qualified person reviews cross-border and children's-data rules (3.5).
5. 30-day purge and Clear chat on the new path: **yes**; the chat UI tells users chats are kept 30 days.
6. Avatar EXIF: **fix before the quest ships** (Stage A1), mobile and web `ProfileForm`, plus a one-off scrub.

Further changes from the review: Stage A0 ships the `anonymise_account` fix first (section 5); per-IP cap 150 (3.7);
`reasoning_effort` low, a larger output cap and `finish_reason = length` as an error (3.3); `maxDuration` of at
least 45 s (3.3); self-delete policy dropped later (section 5); a bad bearer returns 401 (3.3); badge atomicity
route chosen in Stage B after reading both award functions (3.2).
