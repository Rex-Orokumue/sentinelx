# WhatsApp Notifications via Termii (#12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send WhatsApp notifications for registration-confirmed, fixture-reminder, result-confirmed, and prize-credited — built ready-to-activate, gracefully no-op without `TERMII_API_KEY`.

**Architecture:** Pure `templates.ts`/`keys.ts`/`window.ts` (unit-tested) + a `termii.ts` adapter (no-op without key) + `notify.ts` orchestration (insert-log-first, best-effort/never-throws) writing to a `notifications` table. Three event triggers call `notify` inline; fixture reminders run via a secured API route driven by `pg_cron`+`pg_net` (scheduled out-of-band at deploy).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service-role client), Vitest.

## Global Constraints

- **Best-effort:** every `notify()` is wrapped so a send failure NEVER breaks the caller's primary action.
- **Always log the rendered body:** every attempt writes a `notifications` row with `template_name` + `body`.
- **Insert with `status='skipped'`** (conservative default — no `pending` in the CHECK), then UPDATE to `sent`/`failed`.
- **Idempotent** via UNIQUE `dedupe_key`; exact formats: `reg:{registration_id}`, `reminder:{match_id}:{player_id}`, `result:{match_id}:{player_id}`, `prize:{withdrawal_id}`.
- **Graceful no-op:** `termii.sendWhatsApp` returns `{ skipped: true }` when `TERMII_API_KEY` is absent.
- **No secrets in git:** the `pg_cron` schedule (embeds `CRON_SECRET`) is applied out-of-band via `execute_sql` at deploy; the exact SQL is in Task 7.
- **Consent** = presence of `profiles.whatsapp_number`; absent → logged `skipped`.
- Tests: Vitest, colocated `*.test.ts`; run one file with `npx vitest run <path>`. Never run concurrent builds (`.next` race).

---

### Task 1: notifications table + extensions + env example

**Files:**
- Create: `supabase/migrations/011_notifications.sql`
- Modify: `lib/supabase/types.ts` (regenerated)
- Create: `.env.local.example`

**Interfaces:**
- Produces: the `notifications` table (+ its Row/Insert types). Consumed by Task 4.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/011_notifications.sql`:

```sql
-- Scheduling + HTTP-from-Postgres, used by the fixture-reminder cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Notification audit log (also the dedupe guarantee and the exact-text record
-- for Termii template submission). System-only: written by the service-role client.
CREATE TABLE public.notifications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          uuid        NOT NULL REFERENCES public.profiles(id),
  type               text        NOT NULL
                       CHECK (type IN ('registration_confirmed', 'fixture_reminder',
                                       'result_confirmed', 'prize_credited')),
  channel            text        NOT NULL DEFAULT 'whatsapp',
  to_number          text,
  template_name      text        NOT NULL,
  body               text        NOT NULL,
  status             text        NOT NULL
                       CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_reference text,
  error              text,
  dedupe_key         text        NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz
);

CREATE INDEX ON public.notifications (player_id, created_at DESC);

-- RLS on with NO policies: no anon/authenticated access; the service-role client
-- (which bypasses RLS) is the only reader/writer. This is a system log.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply to the live project**

Apply via Supabase MCP `apply_migration` (name: `notifications`, the SQL above). If enabling `pg_cron`/`pg_net` requires elevated rights and errors, apply the `CREATE EXTENSION` lines first via `execute_sql`, then the table.

- [ ] **Step 3: Verify**

Via MCP `execute_sql`:
```sql
SELECT count(*) FROM public.notifications;
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY extname;
```
Expected: `0`; both extensions listed.

- [ ] **Step 4: Regenerate types**

Run Supabase MCP `generate_typescript_types` for project `itxubrkbropttfdackmi` and overwrite `lib/supabase/types.ts` (adds `notifications`).

- [ ] **Step 5: Create the env example**

Create `.env.local.example`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Paystack
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
PAYSTACK_SECRET_KEY=

# Site
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL=

# WhatsApp notifications (Termii) — leave TERMII_API_KEY blank to disable sending (no-op)
TERMII_API_KEY=
TERMII_SENDER_ID=
TERMII_BASE_URL=https://api.ng.termii.com

# Fixture-reminder cron auth (shared secret between pg_cron and the API route)
CRON_SECRET=
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add supabase/migrations/011_notifications.sql lib/supabase/types.ts .env.local.example
git commit -m "feat: notifications table + pg_cron/pg_net + env example (#12)"
```

---

### Task 2: Message templates

**Files:**
- Create: `lib/notifications/templates.ts`
- Test: `lib/notifications/templates.test.ts`

**Interfaces:**
- Produces: `TemplateInput` (discriminated union), `RenderedTemplate { templateName, body }`, `renderTemplate(input): RenderedTemplate`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `lib/notifications/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderTemplate } from './templates'

describe('renderTemplate', () => {
  it('registration_confirmed includes the tournament', () => {
    const r = renderTemplate({ type: 'registration_confirmed', tournament: 'DLS Cup' })
    expect(r.templateName).toBe('registration_confirmed')
    expect(r.body).toContain('DLS Cup')
  })
  it('fixture_reminder includes both players and the URL', () => {
    const r = renderTemplate({ type: 'fixture_reminder', playerA: 'Rex', playerB: 'Sam', tournament: 'DLS Cup', matchUrl: 'https://x/m/1' })
    expect(r.body).toContain('Rex')
    expect(r.body).toContain('Sam')
    expect(r.body).toContain('https://x/m/1')
  })
  it('result_confirmed includes the scoreline', () => {
    const r = renderTemplate({ type: 'result_confirmed', playerA: 'Rex', playerB: 'Sam', scoreA: 3, scoreB: 1, tournament: 'DLS Cup' })
    expect(r.body).toContain('3')
    expect(r.body).toContain('1')
  })
  it('prize_credited includes the amount', () => {
    const r = renderTemplate({ type: 'prize_credited', amount: '₦10,000' })
    expect(r.body).toContain('₦10,000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/templates.test.ts`
Expected: FAIL — cannot resolve `./templates`.

- [ ] **Step 3: Write the implementation**

Create `lib/notifications/templates.ts`:

```ts
export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }

export interface RenderedTemplate {
  templateName: string
  body: string
}

export function renderTemplate(input: TemplateInput): RenderedTemplate {
  switch (input.type) {
    case 'registration_confirmed':
      return {
        templateName: 'registration_confirmed',
        body: `✅ You're registered for ${input.tournament} on Sentinel X! Entry confirmed — we'll remind you before your matches. Good luck! 🎮`,
      }
    case 'fixture_reminder':
      return {
        templateName: 'fixture_reminder',
        body: `⏰ Your Sentinel X match starts in ~1 hour: ${input.playerA} vs ${input.playerB} (${input.tournament}). Get ready → ${input.matchUrl}`,
      }
    case 'result_confirmed':
      return {
        templateName: 'result_confirmed',
        body: `🏁 Result confirmed: ${input.playerA} ${input.scoreA}–${input.scoreB} ${input.playerB} (${input.tournament}). See the updated bracket on Sentinel X.`,
      }
    case 'prize_credited':
      return {
        templateName: 'prize_credited',
        body: `💸 Your prize withdrawal of ${input.amount} has been paid to your bank account. Thanks for competing on Sentinel X! 🏆`,
      }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/templates.ts lib/notifications/templates.test.ts
git commit -m "feat: notification message templates (#12)"
```

---

### Task 3: Dedupe keys + reminder window

**Files:**
- Create: `lib/notifications/keys.ts`
- Create: `lib/notifications/window.ts`
- Test: `lib/notifications/keys.test.ts`
- Test: `lib/notifications/window.test.ts`

**Interfaces:**
- Produces: `regKey`, `reminderKey`, `resultKey`, `prizeKey`; `isWithinReminderWindow(scheduledAtISO, now): boolean`. Consumed by Tasks 4–6.

- [ ] **Step 1: Write the failing tests**

Create `lib/notifications/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { regKey, reminderKey, resultKey, prizeKey } from './keys'

describe('dedupe keys', () => {
  it('formats each key type', () => {
    expect(regKey('r1')).toBe('reg:r1')
    expect(reminderKey('m1', 'p1')).toBe('reminder:m1:p1')
    expect(resultKey('m1', 'p1')).toBe('result:m1:p1')
    expect(prizeKey('w1')).toBe('prize:w1')
  })
})
```

Create `lib/notifications/window.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isWithinReminderWindow } from './window'

const now = new Date('2026-07-10T12:00:00Z')
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()

describe('isWithinReminderWindow', () => {
  it('is true for a match ~1 hour out', () => {
    expect(isWithinReminderWindow(at(60), now)).toBe(true)
  })
  it('is true at the window edge (65 min) and false beyond it', () => {
    expect(isWithinReminderWindow(at(65), now)).toBe(true)
    expect(isWithinReminderWindow(at(66), now)).toBe(false)
  })
  it('is false for a past or missing time', () => {
    expect(isWithinReminderWindow(at(-5), now)).toBe(false)
    expect(isWithinReminderWindow(null, now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/window.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Write the implementations**

Create `lib/notifications/keys.ts`:

```ts
// UNIQUE dedupe keys — the once-only guarantee for each notification type.
export const regKey = (registrationId: string) => `reg:${registrationId}`
export const reminderKey = (matchId: string, playerId: string) => `reminder:${matchId}:${playerId}`
export const resultKey = (matchId: string, playerId: string) => `result:${matchId}:${playerId}`
export const prizeKey = (withdrawalId: string) => `prize:${withdrawalId}`
```

Create `lib/notifications/window.ts`:

```ts
// A match is due for a ~1-hour reminder when it starts within the next 65 minutes.
// The cron runs every 15 min; the log dedupe means each match reminds exactly once.
const WINDOW_MINUTES = 65

export function isWithinReminderWindow(scheduledAtISO: string | null, now: Date): boolean {
  if (!scheduledAtISO) return false
  const t = new Date(scheduledAtISO).getTime()
  if (Number.isNaN(t)) return false
  const nowMs = now.getTime()
  return t > nowMs && t <= nowMs + WINDOW_MINUTES * 60_000
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/notifications/keys.test.ts lib/notifications/window.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/keys.ts lib/notifications/window.ts lib/notifications/keys.test.ts lib/notifications/window.test.ts
git commit -m "feat: notification dedupe keys + reminder window (#12)"
```

---

### Task 4: Termii adapter + notify orchestration

**Files:**
- Create: `lib/notifications/termii.ts`
- Test: `lib/notifications/termii.test.ts`
- Create: `lib/notifications/notify.ts`

**Interfaces:**
- Consumes: `renderTemplate`/`TemplateInput` (Task 2); `createAdminClient` (`@/lib/supabase/admin`).
- Produces: `sendWhatsApp({ to, templateName, body }): Promise<SendResult>`; `NotifyInput = TemplateInput & { playerId, dedupeKey }`; `notify(input: NotifyInput): Promise<void>`. Consumed by Tasks 5–6.

- [ ] **Step 1: Write the failing test (adapter no-op)**

Create `lib/notifications/termii.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { sendWhatsApp } from './termii'

const original = process.env.TERMII_API_KEY
afterEach(() => {
  if (original === undefined) delete process.env.TERMII_API_KEY
  else process.env.TERMII_API_KEY = original
})

describe('sendWhatsApp', () => {
  it('no-ops (skipped) when no API key is configured', async () => {
    delete process.env.TERMII_API_KEY
    const r = await sendWhatsApp({ to: '+2348000000000', templateName: 'x', body: 'hi' })
    expect(r).toEqual({ ok: false, skipped: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/termii.test.ts`
Expected: FAIL — cannot resolve `./termii`.

- [ ] **Step 3: Write the Termii adapter**

Create `lib/notifications/termii.ts`:

```ts
export interface SendResult {
  ok: boolean
  providerRef?: string
  error?: string
  skipped?: boolean
}

// Sends a WhatsApp message via Termii. No-ops when TERMII_API_KEY is unset, so the
// whole pipeline runs harmlessly until the account/templates are live.
// NOTE: the exact Termii request shape is finalized against the real account; this is
// isolated here so callers never change. Only runs when a key is present.
export async function sendWhatsApp(args: {
  to: string
  templateName: string
  body: string
}): Promise<SendResult> {
  const apiKey = process.env.TERMII_API_KEY
  if (!apiKey) return { ok: false, skipped: true }

  const baseUrl = process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com'
  const from = process.env.TERMII_SENDER_ID ?? ''
  try {
    const res = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: args.to,
        from,
        sms: args.body,
        channel: 'whatsapp',
        type: 'plain',
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string }
    if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` }
    return { ok: true, providerRef: json.message_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/termii.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the notify orchestration**

Create `lib/notifications/notify.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTemplate, type TemplateInput } from './templates'
import { sendWhatsApp } from './termii'

export type NotifyInput = TemplateInput & { playerId: string; dedupeKey: string }

// Best-effort: NEVER throws into the caller's primary action. Logs every attempt
// (insert-first with status='skipped'), dedupes on the UNIQUE dedupe_key, then
// upgrades the row to 'sent'/'failed' based on the send result.
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const { templateName, body } = renderTemplate(input)
    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('whatsapp_number')
      .eq('id', input.playerId)
      .maybeSingle()
    const toNumber = profile?.whatsapp_number ?? null

    // Insert-first, conservative default; on dedupe_key conflict this inserts nothing
    // and returns no row → idempotent early return.
    const { data: inserted } = await admin
      .from('notifications')
      .upsert(
        {
          player_id: input.playerId,
          type: input.type,
          to_number: toNumber,
          template_name: templateName,
          body,
          status: 'skipped',
          dedupe_key: input.dedupeKey,
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()

    if (!inserted) return // duplicate (already handled) or insert failed → stop
    if (!toNumber) return // no recipient → stays 'skipped'

    const result = await sendWhatsApp({ to: toNumber, templateName, body })
    if (result.skipped) return // no provider configured → stays 'skipped'

    if (result.ok) {
      await admin
        .from('notifications')
        .update({ status: 'sent', provider_reference: result.providerRef ?? null, sent_at: new Date().toISOString() })
        .eq('id', inserted.id)
    } else {
      await admin
        .from('notifications')
        .update({ status: 'failed', error: result.error ?? 'unknown error' })
        .eq('id', inserted.id)
    }
  } catch {
    // best-effort — swallow so the caller's action is never affected
  }
}
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add lib/notifications/termii.ts lib/notifications/termii.test.ts lib/notifications/notify.ts
git commit -m "feat: Termii adapter (no-op without key) + notify orchestration (#12)"
```

---

### Task 5: Wire the three event triggers

**Files:**
- Modify: `lib/tournaments/confirm.ts`
- Modify: `lib/matches/verify-actions.ts`
- Modify: `lib/withdrawals/admin-actions.ts`

**Interfaces:**
- Consumes: `notify` (Task 4); `regKey`/`resultKey`/`prizeKey` (Task 3); `formatNaira` (`@/lib/format`).

- [ ] **Step 1: Registration confirmed**

In `lib/tournaments/confirm.ts`, add imports at the top:

```ts
import { notify } from '@/lib/notifications/notify'
import { regKey } from '@/lib/notifications/keys'
```

Widen the `existing` select to include the player and tournament title:

```ts
  const { data: existing } = await db
    .from('tournament_registrations')
    .select('id, payment_status, player_id, tournament:tournaments(title)')
    .eq('paystack_reference', reference)
    .maybeSingle()
```

Then, replace the final `return 'confirmed'` with a best-effort notify before returning:

```ts
  const tv = existing.tournament as { title: string } | { title: string }[] | null
  const tournamentTitle = (Array.isArray(tv) ? tv[0]?.title : tv?.title) ?? 'the tournament'
  await notify({
    type: 'registration_confirmed',
    playerId: existing.player_id,
    dedupeKey: regKey(existing.id),
    tournament: tournamentTitle,
  })

  return 'confirmed'
```

- [ ] **Step 2: Result confirmed**

In `lib/matches/verify-actions.ts`, add imports:

```ts
import { notify } from '@/lib/notifications/notify'
import { resultKey } from '@/lib/notifications/keys'
```

In `confirmResult`, immediately before `revalidateAll(m.tournament_id, slug, id)`, add a best-effort block (a dedicated fetch keeps the existing `m`/advancement logic untouched):

```ts
  const { data: nd } = await admin
    .from('matches')
    .select(
      'player_a_id, player_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', id)
    .maybeSingle()
  if (nd) {
    type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
    const nameOf = (x: NameRef) => {
      const r = Array.isArray(x) ? x[0] ?? null : x
      return r?.display_name ?? r?.username ?? 'Player'
    }
    const tRef = nd.tournament as { title: string } | { title: string }[] | null
    const title = (Array.isArray(tRef) ? tRef[0]?.title : tRef?.title) ?? 'the tournament'
    const a = nameOf(nd.player_a as NameRef)
    const b = nameOf(nd.player_b as NameRef)
    for (const pid of [nd.player_a_id, nd.player_b_id]) {
      if (!pid) continue
      await notify({
        type: 'result_confirmed',
        playerId: pid,
        dedupeKey: resultKey(id, pid),
        playerA: a,
        playerB: b,
        scoreA,
        scoreB,
        tournament: title,
      })
    }
  }

  revalidateAll(m.tournament_id, slug, id)
```

- [ ] **Step 3: Prize credited**

In `lib/withdrawals/admin-actions.ts`, add imports:

```ts
import { notify } from '@/lib/notifications/notify'
import { prizeKey } from '@/lib/notifications/keys'
import { formatNaira } from '@/lib/format'
```

Widen the `wr` select and notify on `paid` before returning success. Change the select:

```ts
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
```

Then, after the successful update block and before `revalidatePath('/admin/withdrawals')`, add:

```ts
  if (action === 'paid') {
    await notify({
      type: 'prize_credited',
      playerId: wr.player_id,
      dedupeKey: prizeKey(id),
      amount: formatNaira(wr.amount),
    })
  }

```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles. (If a widened embed trips the type parser, cast with `as` like the existing dashboard/profile queries — the `NameRef`/tournament guards above already handle object-or-array.)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/confirm.ts lib/matches/verify-actions.ts lib/withdrawals/admin-actions.ts
git commit -m "feat: fire WhatsApp notifications on registration/result/prize (#12)"
```

---

### Task 6: Fixture-reminder cron route

**Files:**
- Create: `app/api/cron/fixture-reminders/route.ts`

**Interfaces:**
- Consumes: `notify` (Task 4); `reminderKey` (Task 3); `isWithinReminderWindow` (Task 3); `createAdminClient`.

- [ ] **Step 1: Write the route**

Create `app/api/cron/fixture-reminders/route.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { reminderKey } from '@/lib/notifications/keys'
import { isWithinReminderWindow } from '@/lib/notifications/window'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type NameRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
}
type TitleRef = { title: string } | { title: string }[] | null
function titleOf(x: TitleRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? 'the tournament'
}

type ReminderRow = {
  id: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  tournament: TitleRef
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const horizon = new Date(now.getTime() + 65 * 60_000).toISOString()

  const { data } = await admin
    .from('matches')
    .select(
      'id, scheduled_at, player_a_id, player_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon)

  const rows = (data ?? []) as unknown as ReminderRow[]
  let reminded = 0
  for (const m of rows) {
    if (!isWithinReminderWindow(m.scheduled_at, now)) continue
    if (!m.player_a_id || !m.player_b_id) continue
    const a = nameOf(m.player_a)
    const b = nameOf(m.player_b)
    const tournament = titleOf(m.tournament)
    const matchUrl = `${SITE_URL}/matches/${m.id}`
    for (const pid of [m.player_a_id, m.player_b_id]) {
      await notify({
        type: 'fixture_reminder',
        playerId: pid,
        dedupeKey: reminderKey(m.id, pid),
        playerA: a,
        playerB: b,
        tournament,
        matchUrl,
      })
      reminded += 1
    }
  }

  return Response.json({ reminded })
}
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; `/api/cron/fixture-reminders` in the route list.

- [ ] **Step 3: Commit**

```bash
git add "app/api/cron/fixture-reminders/route.ts"
git commit -m "feat: fixture-reminder cron route (secured, dedup-guarded) (#12)"
```

---

### Task 7: Verification, push, and activation checklist

**Files:** none (verification + documented activation).

- [ ] **Step 1: Full test + type gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (incl. templates/keys/window/termii); no type errors.

- [ ] **Step 2: Single clean build**

Run **one** build: `npm run build`
Expected: exit 0; route list includes `/api/cron/fixture-reminders`. (If `ENOENT ... 500.html`, `rm -rf .next` and rebuild once.)

- [ ] **Step 3: Cron route auth smoke test**

Start the built server (`npm run start`). With no `CRON_SECRET` in `.env.local`, the route must reject:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/cron/fixture-reminders
```
Expected: **401**. Stop the server. (The authorized 200 path — `{ reminded: 0 }` given no scheduled matches — activates once `CRON_SECRET` is set; it can't send anyway without `TERMII_API_KEY`.)

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Record the activation checklist (do NOT run now — for when Termii is live)**

Add nothing to git; this is the operational runbook to execute at activation:

1. In Vercel env (and local `.env.local`), set `TERMII_API_KEY`, `TERMII_SENDER_ID`, `CRON_SECRET` (and `TERMII_BASE_URL` if not default). Redeploy.
2. Submit the four message bodies (pull the exact text from any `notifications.body`, or from `lib/notifications/templates.ts`) for Meta template approval via Termii.
3. Once approved, schedule the cron via Supabase MCP `execute_sql` (replace `<CRON_SECRET>` with the real value — this is why it's out-of-band, never in git):

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
To later change or stop it: `select cron.unschedule('fixture-reminders');`

---

## Self-Review

- **Spec coverage:** §2 table+extensions+env+dedupe-keys → Task 1 (table/ext/env) + Task 3 (keys); §3 templates/adapter/notify (insert-first `skipped`, best-effort) → Tasks 2, 4; §4 three event triggers → Task 5; §5 cron route + out-of-band pg_cron SQL → Task 6 + Task 7 Step 5; §6 tests/degradation → Tasks 2–4 + Task 7. All covered.
- **Placeholder scan:** none — every code step is complete; the only `<CRON_SECRET>` is the intentional deploy-time placeholder in the activation runbook.
- **Type consistency:** `TemplateInput` (Task 2) is extended by `NotifyInput = TemplateInput & { playerId, dedupeKey }` (Task 4) and passed to `renderTemplate` (structurally valid — union ∩ object). `notify(NotifyInput)` calls in Task 5/6 supply exactly the variant fields (`tournament`; `playerA/playerB/scoreA/scoreB/tournament`; `amount`; `playerA/playerB/tournament/matchUrl`) plus `playerId`/`dedupeKey`. Key builders (`regKey`/`resultKey`/`prizeKey`/`reminderKey`, Task 3) are called with the documented args. `sendWhatsApp({to,templateName,body})` (Task 4) matches its `notify` call site. The notifications Insert shape (Task 4 upsert) matches the Task 1 columns.
- **Embedded-join note:** the widened selects in Tasks 5–6 use object-or-array guards (`Array.isArray(...)`) for the single/multi embeds, matching the pattern already used across the codebase; the reminder query result is cast `as unknown as ReminderRow[]`.
