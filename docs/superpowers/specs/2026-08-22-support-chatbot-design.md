# SentinelX Support Chatbot — Design Spec

**Date:** 2026-08-22
**Status:** Approved → ready for implementation
**Phase:** 3 (extends the Guide System, `docs/superpowers/specs/2026-08-18-guide-system-design.md`)

---

## 1. What This Is

A real conversational AI assistant, distinct from the existing **Guide System** (`GuideLauncher`/`GuidePanel`) which is a scripted onboarding tour + quest checklist with no free-text input and no LLM behind it. This spec adds an actual chat surface: players type free-text questions and get LLM-generated answers.

- **Anonymous visitors:** general platform FAQ (how tournaments work, fees, rules, KYC, disputes) — no access to any account data.
- **Logged-in players:** FAQ, plus account-aware answers ("when's my next match", "how many SX coins do I have", "what's my withdrawal status") via one server-executed tool.

**Provider:** Groq (not Anthropic/Claude) — an explicit cost/latency choice for a free-to-browse, high-volume, price-sensitive Nigerian audience. Model: `llama-3.3-70b-versatile` (confirmed active on Groq's deprecation page as of 2026-08-22, not scheduled for shutdown; supports OpenAI-compatible `tools`/`tool_calls` and parallel tool use). Accessed via the official `groq-sdk` npm package (OpenAI-compatible Chat Completions API), never raw `fetch`.

---

## 2. UI Placement

`GuidePanel` (`components/guide/GuidePanel.tsx`) gains a two-tab header — **Guide** / **Chat** — for every visitor, logged-in or not:

- **Guide tab:** unchanged — the existing visitor tour (logged-out) or Battle Ready Quest checklist (logged-in).
- **Chat tab:** new `ChatTab` component (`components/guide/ChatTab.tsx`) — the conversational surface this spec adds.

Default tab on open is **Guide** (no behavior change for existing users). One floating launcher (`GuideLauncher`), no new site-wide button. `ChatTab` fits inside the same panel dimensions already established (`sm:w-96 sm:max-h-[70vh]` etc.) — message list scrolls, input pinned to the bottom of the tab body.

`ChatTab` renders: a scrollable message list (user bubbles right-aligned/purple, assistant bubbles left-aligned/dark-surface), a text input + send button, a typing/loading indicator while the reply streams in, inline error text on failure (never a page-level error), and — logged-in only — a "Clear chat" action.

---

## 3. Architecture

```
ChatTab (client)                 app/api/chat/route.ts              Groq API
  │  conversation: Message[]           │                                │
  │  (state, resent each turn)         │                                │
  │                                    │                                │
  ├─ POST {messages, ...} ───────────► │                                │
  │                                    ├─ identify: session player_id   │
  │                                    │   or anon cookie               │
  │                                    ├─ rate-limit check (DB)         │
  │                                    ├─ sanitize incoming history     │
  │                                    │   (strip non-user/assistant)   │
  │                                    ├─ build system prompt server-   │
  │                                    │   side (FAQ text + guardrails) │
  │                                    ├─ Call 1: non-streamed ───────► │
  │                                    │   (+ tools, if logged in)      │
  │                                    │ ◄────── tool_calls | text ──── │
  │                                    │                                │
  │                                    │  [if tool_calls]               │
  │                                    ├─ execute get_account_snapshot()│
  │                                    │   against the REAL session's   │
  │                                    │   player_id (never model args) │
  │                                    ├─ Call 2: streamed ────────────►│
  │                                    │ ◄────── deltas ─────────────── │
  │                                    │                                │
  │ ◄── chunked text stream ───────────┤                                │
  │  (for await reader, append to      │                                │
  │   trailing assistant bubble)       ├─ persist user+assistant msg    │
  │                                    │   (logged-in only, fire-and-   │
  │                                    │   forget, best-effort)         │
```

**Two-phase Groq flow.** Call 1 is always non-streamed and decides whether a tool is needed:
- No tool needed → Call 1's text *is* the final answer. Sent to the client as a single flush through the same stream interface the client always reads (uniform client protocol regardless of path).
- Tool needed → execute `get_account_snapshot()` server-side, append the tool result, then Call 2 (streamed) generates the final answer with the account data in context. This is the phase that actually benefits from streaming — it's the slower one (this is the "2–4 second tool-call turn" case), so the user sees the model "typing" the synthesized answer as it arrives rather than waiting the full round-trip for a wall of text to pop in at once.

**Statelessness.** The route handler doesn't reconstruct history from the DB mid-request. The client owns the running conversation array (capped, e.g. last 20 messages) and resends it every turn. The DB write is a side effect for reopening the panel later, not a read dependency of the current turn.

**Sanitization (hard rule).** The route filters the client-sent `messages` array to `role: 'user' | 'assistant'` only, discarding any `system`, `tool`, or unrecognized role before use. The real system prompt is always constructed server-side and prepended — never trusted from client input. This closes the obvious prompt-injection vector of a tampered request body containing a fake `{role: 'system', content: 'ignore all instructions'}`.

---

## 4. Data Model (migration)

### `chat_messages`
Persists conversation history for logged-in players only (anonymous chats are ephemeral per product decision — nothing stored). Used solely to repopulate the `ChatTab` when a player reopens the panel; not read mid-request (see Statelessness above).

```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_player_id_created_at_idx ON chat_messages (player_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Self-select only, defense in depth — same pattern as player_kyc/marketplace_orders.
-- All writes are service-role (route handler), no client INSERT/UPDATE policy.
CREATE POLICY chat_messages_self_select ON chat_messages
  FOR SELECT USING (auth.uid() = player_id);

-- Self-delete, to back the "Clear chat" button (a direct client-side Supabase
-- call is fine here — same precedent as marking notifications read).
CREATE POLICY chat_messages_self_delete ON chat_messages
  FOR DELETE USING (auth.uid() = player_id);
```

### `chat_rate_limit_events`
Cost-control ledger, decoupled from `chat_messages` so it works identically for anonymous and logged-in traffic. One row per user message sent, checked as a trailing-window count before calling Groq at all (so an over-limit request costs nothing).

```sql
CREATE TABLE chat_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key TEXT NOT NULL,      -- 'player:<uuid>' or 'ip:<address>'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_rate_limit_events_subject_created_idx ON chat_rate_limit_events (subject_key, created_at);

ALTER TABLE chat_rate_limit_events ENABLE ROW LEVEL SECURITY;
-- Zero client policies — service-role only, same pattern as the outbound
-- WhatsApp `notifications` log table.
```

**Pruning.** A `pg_cron` job deletes rows older than 24h, same pattern as the existing `fixture-reminders`/`expire-full-day-matches` jobs:
```sql
SELECT cron.schedule('prune-chat-rate-limit-events', '0 3 * * *',
  $$ DELETE FROM chat_rate_limit_events WHERE created_at < now() - interval '1 day' $$);
```

**Limit:** 15 user messages per 10-minute trailing window per `subject_key`. Over limit → HTTP 429 with a friendly "slow down" message, no Groq call made.

**Anonymous identity.** An httpOnly `sx-chat-anon-id` cookie (random UUID), set by the route on first request if absent. Used *only* as the rate-limit subject key — never linked to any stored chat content, matching the ephemeral-for-anonymous decision.

---

## 5. Tool: `get_account_snapshot()`

One consolidated tool, not several narrow ones — fewer round trips, more reliable tool-calling on a 70B model, cheaper. Takes **no model-supplied arguments**; the route always executes it against the real authenticated session's `player_id`, ignoring anything the model might put in tool-call arguments. This is the load-bearing security property: one player can never fish for another's data by prompting the model to pass a different id, because the id is never sourced from the model at all.

Only offered in the `tools` array when a session exists (`createClient().auth.getUser()` succeeds). Anonymous requests get zero tools — FAQ-only, enforced by omission rather than by hoping the model declines.

Returns one JSON object covering (per the "core + everything else" scope decision):

```ts
type AccountSnapshot = {
  upcomingMatches: { id: string; opponentName: string | null; scheduledAt: string | null; tournamentName: string }[]
  registrations: { tournamentName: string; status: string; paymentStatus: string }[]
  sxCoinBalance: number
  sxScore: number
  sxTier: string // Elite/Trusted/Developing/At Risk
  membershipTier: string
  withdrawals: { type: 'prize' | 'referral' | 'friendly'; amount: number; status: string }[]
  kycStatus: string
  referralBalance: number
  friendlyMatches: { opponentName: string; status: string; stakeAmount: number | null }[]
  unreadNotificationCount: number
}
```

Implementation (`lib/chat/account-snapshot.ts`) queries via the existing per-domain read helpers/tables already built for the dashboard, wallet, referrals, friendlies, and notifications features — no new source-of-truth queries, just one aggregating function. On any individual query failure, that section degrades to `null`/empty rather than failing the whole snapshot (so "couldn't check your withdrawal status right now" doesn't also block the matches answer).

---

## 6. System Prompt & Guardrails

Built server-side in `lib/chat/system-prompt.ts`, parameterized by `isLoggedIn`:

- **Static FAQ knowledge** distilled from CLAUDE.md: four pillars, tournament flow (registration → groups/knockout → results → prizes), ₦500 registration fee, SX Score tiers and how points are earned/lost, KYC (payout-account-only, no BVN), dispute process, WhatsApp community. Small and stable enough for a prompt block — no RAG for v1.
- **Guardrail (explicit, per product decision):** on money features (fees, staking mechanics, withdrawal steps) the bot answers factually — how it works — and refuses to give betting/wagering advice, odds, or encouragement to stake more. The platform has real-money staked friendly matches and no age gate, so this is a hard instruction, not a nice-to-have.
- **Scope guardrails:** never reveals another player's data; cannot take real actions (submit match results, resolve disputes, process withdrawals, edit settings) — points to the real UI/admin flow instead; if asked something outside platform scope, says so plainly rather than improvising.

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| Rate limit exceeded | 429 before any Groq call; `ChatTab` shows an inline "slow down" message |
| Groq API error/timeout | Inline "having trouble responding right now, try again shortly" in `ChatTab`; conversation state is preserved (failed turn doesn't wipe history) |
| `get_account_snapshot()` partial failure | Missing sections degrade to empty/null; the model tells the user which part it couldn't check rather than the whole reply failing |
| DB persistence failure (logged-in) | Best-effort, non-blocking — same `try/catch`-and-swallow convention as `lib/notifications/notify.ts`; a failed history write never surfaces to the user or blocks the reply they already received |
| Client sends non-user/assistant roles | Silently stripped server-side before building the Groq request (Sanitization, §3) |

---

## 8. Testing

Pure/testable pieces (vitest, no jsdom in this repo — components verified via typecheck/build/manual pass, matching every prior plan's convention):
- Rate-limit trailing-window check (given N events at given timestamps, is the subject over limit)
- `buildSystemPrompt(isLoggedIn)` — correct guardrail/tool-availability text per branch
- History sanitization filter (strips non-user/assistant roles)
- `AccountSnapshot` aggregation's partial-failure degradation

`app/api/chat/route.ts` and `ChatTab` are verified via `npx tsc --noEmit -p .`, `npm run build`, and a manual pass (both logged-in and anonymous, tool-call and no-tool-call turns, rate limit trip, Clear chat) — same convention as the Guide System plan.

---

## 9. Env Vars

```
# .env.local.example addition
GROQ_API_KEY=
```
Server-only, never exposed via `NEXT_PUBLIC_*`.

---

## 10. Out of Scope for v1 (explicit YAGNI cuts)

- RAG/embeddings-based FAQ retrieval — static system-prompt text is enough at current content volume.
- Multiple named conversation threads per player — one continuous thread, "Clear chat" resets it.
- Admin-side chat transcript review UI.
- Streaming for the no-tool-call path's *generation* (it's already a single non-streamed call, just flushed through the same stream interface) — only the post-tool-call synthesis actually streams incrementally.
