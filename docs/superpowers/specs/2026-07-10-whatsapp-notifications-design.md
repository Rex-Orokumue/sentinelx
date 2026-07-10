# WhatsApp Notifications via Termii (#12) — Design Spec

**Date:** 2026-07-10
**Status:** Approved design → ready for implementation plan
**Scope:** v2.0 #12 (final v2.0 task) — WhatsApp notifications for the four key player events.

---

## 1. Goal & posture

Send WhatsApp notifications for four events: **registration confirmed**, **fixture reminder (~1h before)**, **result confirmed**, **prize credited**. Built **ready-to-activate**: full infrastructure now, **gracefully no-op when `TERMII_API_KEY` is absent** (dev/preview never error, nothing sends). Delivery switches on when the Termii account + Meta-approved templates + key are in place — an out-of-band, multi-day process that must not block this code.

**Key principles:**
- **Best-effort / fire-and-forget:** a notification failure must NEVER break its primary action (a Termii timeout can't fail a payment confirmation or result update). Every `notify()` is wrapped in try/catch; errors are logged to the `notifications` table; the caller proceeds regardless.
- **Always log the rendered body:** every attempt writes a row storing `template_name` + the exact `body`, so (a) you can copy exact text into Termii's template-approval submission, and (b) it's the audit trail for delivery disputes.
- **Consent** = presence of `whatsapp_number` on the profile (providing it is opt-in). No number → logged as `skipped`, nothing sent.

## 2. Data model, extensions, env

### `notifications` table (migration `011_notifications.sql`)

| Column | Type / notes |
|---|---|
| `id` | uuid pk default `gen_random_uuid()` |
| `player_id` | uuid → `profiles(id)` |
| `type` | text CHECK in (`registration_confirmed`, `fixture_reminder`, `result_confirmed`, `prize_credited`) |
| `channel` | text not null default `'whatsapp'` |
| `to_number` | text null (the `whatsapp_number` sent to) |
| `template_name` | text not null (Termii template identifier) |
| `body` | text not null (rendered message text) |
| `status` | text not null CHECK in (`sent`, `failed`, `skipped`) |
| `provider_reference` | text null (Termii message id) |
| `error` | text null |
| `dedupe_key` | text not null **UNIQUE** |
| `created_at` | timestamptz not null default `now()` |
| `sent_at` | timestamptz null |

Index on `(player_id, created_at DESC)`. **RLS:** enable; **no public/user policies** (only the service-role client, which bypasses RLS, reads/writes it — this is a system log, not user-facing).

Same migration also runs:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```
Then **regenerate `lib/supabase/types.ts`**.

### `dedupe_key` formats (exact, per type)

- `registration_confirmed` → `reg:{registration_id}`
- `fixture_reminder` → `reminder:{match_id}:{player_id}`
- `result_confirmed` → `result:{match_id}:{player_id}`
- `prize_credited` → `prize:{withdrawal_id}`

The UNIQUE constraint on `dedupe_key` is the once-only guarantee: insert-first, on conflict skip.

### Env (`.env.local.example`, created)

`TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL` (default `https://api.ng.termii.com`), `CRON_SECRET`.

## 3. Notification service (`lib/notifications/`)

### `templates.ts` (pure, unit-tested)
One builder per type → `{ templateName: string; variables: Record<string,string>; body: string }` where `body` is rendered from the variables. This is the single home of the WhatsApp copy. Bodies (final wording tunable):

- **registration_confirmed** — "✅ You're registered for {tournament} on Sentinel X! Entry confirmed — we'll remind you before your matches. Good luck! 🎮"
- **fixture_reminder** — "⏰ Your Sentinel X match starts in ~1 hour: {playerA} vs {playerB} ({tournament}). Get ready → {matchUrl}"
- **result_confirmed** — "🏁 Result confirmed: {playerA} {scoreA}–{scoreB} {playerB} ({tournament}). See the updated bracket on Sentinel X."
- **prize_credited** — "💸 Your prize withdrawal of {amount} has been paid to your bank account. Thanks for competing on Sentinel X! 🏆"

### `termii.ts` (impure adapter)
`sendWhatsApp({ to, templateName, variables }): Promise<{ ok: boolean; providerRef?: string; error?: string; skipped?: boolean }>`.
- **If `TERMII_API_KEY` is absent → return `{ ok: false, skipped: true }` immediately (sends nothing).**
- Otherwise POST to Termii (payload isolated here — the exact WhatsApp/template shape is finalized against the real account without touching callers).

### `notify.ts` (orchestration, service-role client)
`notify({ type, playerId, dedupeKey, context }): Promise<void>` — never throws:
1. Build the template (rendered `body`).
2. Resolve the player's `whatsapp_number` + display name.
3. **Insert the log row first**, with the unique `dedupe_key` and **initial `status = 'skipped'`** — the conservative default (there is no `pending` state in the CHECK). On conflict (row already exists for this key) → return early, idempotent. Inserting `skipped` first means that even if a later UPDATE is lost after a successful send (rare), the row still exists with a safe status rather than not at all.
4. If no `whatsapp_number` or `termii` returns `skipped` → leave `status='skipped'` (no update needed).
5. Else call `termii.sendWhatsApp` → UPDATE the row to `status='sent'`+`provider_reference`+`sent_at`, or `status='failed'`+`error`.
6. The whole body is wrapped in try/catch; any unexpected error is logged and swallowed.

## 4. Event triggers (wired inline, best-effort)

- **`confirmRegistration`** (`lib/tournaments/confirm.ts`) — on the `confirmed` transition, `await notify({ type: 'registration_confirmed', playerId, dedupeKey: 'reg:'+registrationId, context })`.
- **`confirmResult`** (`lib/matches/verify-actions.ts`) — after the result is saved, `notify` **both** players with `result:{match_id}:{player_id}`.
- **`resolveWithdrawal`** (`lib/withdrawals/admin-actions.ts`) — on `action='paid'`, `notify` the player with `prize:{withdrawal_id}`.

Each call is best-effort and does not affect the action's return value.

## 5. Fixture reminder cron

### `app/api/cron/fixture-reminders/route.ts`
- Validates `Authorization: Bearer ${CRON_SECRET}` (401 otherwise).
- Finds `status='scheduled'` matches with `scheduled_at` in **`(now, now + 65 min]`**, both players present.
- For each present player, `notify({ type: 'fixture_reminder', dedupeKey: 'reminder:'+matchId+':'+playerId, ... })` — the log dedupe means each match reminds each player exactly once even though the cron overlaps windows.
- Returns `{ reminded: n }`.
- A pure `isWithinReminderWindow(scheduledAt, now)` helper (true when `now < scheduledAt <= now+65min`) is unit-tested.

### pg_cron scheduling — applied out-of-band (NOT in a committed migration)
Because the job SQL embeds `CRON_SECRET` + the site URL, it is run once via `execute_sql` at deploy time. **The plan doc includes this exact SQL** (with placeholders for the real secret/URL):
```sql
select cron.schedule(
  'fixture-reminders',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://sentinelxesports.vercel.app/api/cron/fixture-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>')
    );
  $$
);
```
No secret ever enters git.

## 6. Testing & degradation

Vitest covers the pure logic: each `templates.ts` builder (rendered body + variables), the four dedupe-key builders, and `isWithinReminderWindow` (inside/outside the window, boundary). The adapter, route, and cron are thin and integration-only. With no `TERMII_API_KEY`, the full pipeline runs and logs `status='skipped'` — verifiable locally by triggering an event and reading the `notifications` row (body present, status skipped).

## 7. Scope boundaries

**In:** `notifications` table + extensions + env; the service (templates/adapter/notify); the three event triggers; the fixture cron route + pg_cron; unit tests.
**Out (seams left):** notification-preferences / opt-out UI; non-WhatsApp channels (SMS/email); Termii delivery-receipt webhooks; a retry queue for `failed` sends; per-user quiet hours; an admin viewer for the `notifications` log.
