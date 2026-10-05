# Mobile Phase 5c, web half: handoff

Branch `spec/mobile-5c-guide-chatbot` (not pushed). Plan: `docs/superpowers/plans/2026-10-05-mobile-phase5c-web-guide-and-chat.md`. Spec: `docs/superpowers/specs/2026-10-05-mobile-phase5c-guide-and-chatbot-design.md`.
Contract for mobile: `openapi/mobile-v1.json` (regenerated; mobile re-copies it, never hand-edits).

## What shipped (in code)

- Guide: `lib/guide/service.ts` (`getQuests`, lease-based resumable `claimBattleReady`); web `lib/guide/actions.ts` is now a thin wrapper.
- Chat: `lib/chat/{types,text-safety,limits,events,destinations,sections,tools,system-prompt,admission,budget-alert,history,service}.ts`; web `app/api/chat/route.ts` and `lib/chat/actions.ts` use them; `ChatTab` clears via a server action and shows "Chats are kept for 30 days."
- Mobile API: `defineStreamEndpoint` (NDJSON), `strictOptionalAuth`, `prelude.ts`; five operations `getGuideQuests`, `claimGuideBadge`, `postChatMessage`, `getChatHistory`, `deleteChatHistory`; `/me` gains `profile.equippedBubbleSkin` and `profile.bubbleSkinUrl`.
- Avatar: `PATCH /me/profile` only accepts the caller's own `avatars/<uid>/` URL (`invalid_avatar_url`).

## Contract details mobile should rely on

- Stream events (one JSON object per line): `{t:'status',state:'checking_account'}`, `{t:'delta',text}`, `{t:'actions',items:[tournaments|matches|wallet|profile|notifications|rules|safety|help]}`, `{t:'done',persisted}`, `{t:'error',code:'chat_upstream'|'chat_truncated'|'internal'}`. Exactly one terminal event.
- Pre-stream errors use the JSON envelope: `chat_rate_limited` 429 (`fields.retryAfterSeconds`, `Retry-After`), `chat_unavailable` 503, `validation_failed` 400, `unauthorized` 401 (a present but invalid/expired bearer is 401, never anonymous). `chat_upstream` is an in-stream event, not a 502.
- Signed-out identity: `X-Device-Id` header (8-64 chars `[A-Za-z0-9-]`); it only adds a bucket, never raises a limit.
- Claim errors: `quest_incomplete` 409, `claim_in_progress` 409, `reward_unavailable` 503. `claimGuideBadge` needs no `Idempotency-Key`.
- History: `GET /chat/history?before&limit` (default 40, max 100, 30-day window, oldest-first), `DELETE /chat/history` returns `{ok:true}`.

## NOT done / needs the owner

1. **No migration was applied anywhere.** DB writes (even to staging) were blocked in the authoring session. Apply to staging first, run `supabase/tests/chat_erasure.sql` and `supabase/tests/chat_5c.sql` (each must end with the error `ALL_PASSED_ROLLBACK`), then do the 20-parallel-call race check from plan Task 3 Step 5:
   - `20261005140000_chat_erasure.sql` (erasure fix; also purges chat rows of already-anonymised accounts: count them read-only on prod first)
   - `20261005150000_chat_5c.sql` (turn ids, usage ledger, admission functions, prune jobs, reward-lease columns). Must be applied BEFORE the code deploys.
   - `20261005150100_allow_chat_budget_alert_notification_type.sql` (widens `player_notifications_type_check`). Re-verify the live constraint list against the previous migration before applying (not verified).
2. Task 14 eval (`scripts/chat-eval.ts`) not run: needs approval and the staging `GROQ_API_KEY`. Until it passes, the tool description wording and `CHAT_MAX_OUTPUT_TOKENS = 2000` are unverified.
3. Task 15 privacy copy not written: Groq's terms could not be re-verified (docs unreachable) and ZDR is not confirmed enabled.
4. Task 16 (drop `chat_messages_self_delete`) deliberately not started: only after this code is live and Clear chat is confirmed on web.
5. Task 2 avatar audit (`npx tsx scripts/audit-avatars.ts`) not run (needs service-role env).
6. Task 17 staging end-to-end not run (needs the migrations and a deployed staging build).
7. Before deploy: set `CHAT_HASH_PEPPER` (required; chat fails closed with 503 without it), and optionally `CHAT_SIGNED_OUT_DAILY_CEILING`, `CHAT_TOTAL_DAILY_CEILING`, `CHAT_ALERT_PCT`, in Vercel. Do not commit them.

## Residual risks

- `awardXP` is not atomic: a crash between its `profiles.xp` update and its `xp_events` insert is undetectable by the claim's ledger guards.
- Groq parameter names (`reasoning_effort`, `max_completion_tokens`) match `groq-sdk` 1.5.0 types; real behavior is only confirmed by the eval.
- The first upstream call is non-streamed, so a no-tool reply arrives as one delta.
- Mid-run, `node_modules/.bin` in the primary checkout became empty (likely another session); tools were run via `node node_modules/<pkg>/...`.
