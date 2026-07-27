# Fixture-Created Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player gets an in-app (and WhatsApp, once activated) notification the moment a match is created for them and visible — at bracket publish for round 1, and immediately at each later knockout-advance point.

**Architecture:** One new `fixture_assigned` notification type following the exact shape of the existing `result_confirmed` type (template, dedupe key, in-app type). One shared helper batches player-name/tournament lookups and fires both channels per real (non-bye) match. Three call sites feed it: `publishBracket` (the only trigger for round 1, since `generate()` runs pre-publish and must never leak matchups), and the two knockout-advance functions in `verify-actions.ts`.

**Tech Stack:** Next.js 14 Server Actions, Supabase, TypeScript.

## Global Constraints

- `generate()` (`lib/tournaments/bracket-admin-actions.ts`) must remain untouched by this feature — it runs against a `registration_closed` (staff-only preview) tournament, and notifying there would leak matchups before publish.
- `notify()`/`notifyInApp()` are both already best-effort (never throw into the caller) — the new call sites rely on that, no new error handling needed.
- Design source of truth: `docs/superpowers/specs/2026-07-27-fixture-created-notifications-design.md`.

---

### Task 1: New notification type — template, dedupe key, in-app type

**Files:**
- Modify: `lib/notifications/inbox.ts:3-11` (`NotificationType`)
- Modify: `lib/notifications/templates.ts:1-8` (`TemplateInput`), `:15-52` (`renderTemplate`)
- Modify: `lib/notifications/keys.ts`

**Interfaces:**
- Produces: `NotificationType` includes `'fixture_assigned'`; `TemplateInput` includes the `fixture_assigned` variant; `fixtureKey(matchId: string, playerId: string): string` — all consumed by Task 2.

- [ ] **Step 1: Add the in-app notification type**

In `lib/notifications/inbox.ts`, change:

```typescript
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
```

to:

```typescript
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
  | 'fixture_assigned'
```

- [ ] **Step 2: Add the WhatsApp template variant**

In `lib/notifications/templates.ts`, change the `TemplateInput` union from:

```typescript
export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }
  | { type: 'escrow_sale'; title: string }
  | { type: 'escrow_completed'; title: string }
  | { type: 'escrow_refunded'; title: string }
```

to:

```typescript
export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'fixture_assigned'; playerA: string; playerB: string; tournament: string; matchUrl: string; whenLabel: string | null }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }
  | { type: 'escrow_sale'; title: string }
  | { type: 'escrow_completed'; title: string }
  | { type: 'escrow_refunded'; title: string }
```

Add a case to `renderTemplate`'s `switch`, right after the existing `case 'fixture_reminder':` block:

```typescript
    case 'fixture_assigned':
      return {
        templateName: 'fixture_assigned',
        body: `📅 New Sentinel X fixture: ${input.playerA} vs ${input.playerB} (${input.tournament})${
          input.whenLabel ? ` — ${input.whenLabel}` : ''
        }. ${input.matchUrl}`,
      }
```

- [ ] **Step 3: Add the dedupe key**

In `lib/notifications/keys.ts`, add after `reminderKey`:

```typescript
export const fixtureKey = (matchId: string, playerId: string) => `fixture:${matchId}:${playerId}`
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/inbox.ts lib/notifications/templates.ts lib/notifications/keys.ts
git commit -m "feat: add fixture_assigned notification type"
```

---

### Task 2: `notifyNewFixtures` helper — `lib/notifications/fixture-created.ts`

**Files:**
- Create: `lib/notifications/fixture-created.ts`

**Interfaces:**
- Consumes: `notify` (`@/lib/notifications/notify`), `notifyInApp` (`@/lib/notifications/inbox`), `fixtureKey` (Task 1, `@/lib/notifications/keys`), `formatFixtureDate` (`@/lib/format`), `createAdminClient` (`@/lib/supabase/admin`).
- Produces: `NewFixtureRow` type, `notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void>` — consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the file**

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from './notify'
import { notifyInApp } from './inbox'
import { fixtureKey } from './keys'
import { formatFixtureDate } from '@/lib/format'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export interface NewFixtureRow {
  id: string
  tournamentId: string
  playerAId: string
  playerBId: string | null // null => bye, skipped — nothing for the player to prepare for
  scheduledAt: string | null
  isFullDay: boolean
}

// Notifies both players of a newly-created (and now-visible) match: in-app
// always, WhatsApp best-effort (currently a no-op until TERMII_API_KEY is
// set, same as every other notify() call in this codebase).
export async function notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void> {
  const real = rows.filter((r): r is NewFixtureRow & { playerBId: string } => r.playerBId != null)
  if (real.length === 0) return

  const playerIds = Array.from(new Set(real.flatMap((r) => [r.playerAId, r.playerBId])))
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, username, display_name')
    .in('id', playerIds)
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))

  const tournamentIds = Array.from(new Set(real.map((r) => r.tournamentId)))
  const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
  const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

  for (const r of real) {
    const a = nameById.get(r.playerAId) ?? 'Player'
    const b = nameById.get(r.playerBId) ?? 'Player'
    const tournament = titleByTournament.get(r.tournamentId) ?? 'Sentinel X'
    const matchUrl = `${SITE_URL}/matches/${r.id}`
    const whenLabel = formatFixtureDate(r.scheduledAt, r.isFullDay)
    for (const pid of [r.playerAId, r.playerBId]) {
      await notify({
        type: 'fixture_assigned',
        playerId: pid,
        dedupeKey: fixtureKey(r.id, pid),
        playerA: a,
        playerB: b,
        tournament,
        matchUrl,
        whenLabel,
      })
      await notifyInApp({
        playerId: pid,
        type: 'fixture_assigned',
        title: 'New fixture',
        body: `${a} vs ${b} — ${tournament}${whenLabel ? ` · ${whenLabel}` : ''}`,
        link: `/matches/${r.id}`,
      })
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/fixture-created.ts
git commit -m "feat: add notifyNewFixtures helper"
```

---

### Task 3: Wire into `publishBracket` — the only trigger for round 1

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts:197-226` (`publishBracket`)

**Interfaces:**
- Consumes: `notifyNewFixtures`, `type NewFixtureRow` (Task 2, `@/lib/notifications/fixture-created`).

- [ ] **Step 1: Add the import**

At the top of `lib/tournaments/bracket-admin-actions.ts`, add:

```typescript
import { notifyNewFixtures } from '@/lib/notifications/fixture-created'
```

- [ ] **Step 2: Notify after publishing**

Replace the body of `publishBracket` from:

```typescript
  await admin.from('tournaments').update({ status: 'active' }).eq('id', id)
  revalidateAdmin(id)
  revalidatePath(`/tournaments/${t.slug}`)
  revalidatePath(`/tournaments/${t.slug}/bracket`)
  return { success: true }
}
```

to:

```typescript
  await admin.from('tournaments').update({ status: 'active' }).eq('id', id)

  const { data: publishedMatches } = await admin
    .from('matches')
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
    .eq('tournament_id', id)
  await notifyNewFixtures(
    admin,
    (publishedMatches ?? []).map((m) => ({
      id: m.id,
      tournamentId: id,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )

  revalidateAdmin(id)
  revalidatePath(`/tournaments/${t.slug}`)
  revalidatePath(`/tournaments/${t.slug}/bracket`)
  return { success: true }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "feat: notify players of their fixtures when the bracket is published"
```

---

### Task 4: Wire into knockout advancement

**Files:**
- Modify: `lib/matches/verify-actions.ts:118-144` (`recomputeGroupAndMaybeAdvance`), `:172-187` (`advanceKnockout`)

**Interfaces:**
- Consumes: `notifyNewFixtures` (Task 2, `@/lib/notifications/fixture-created`).

- [ ] **Step 1: Add the import**

At the top of `lib/matches/verify-actions.ts`, add:

```typescript
import { notifyNewFixtures } from '@/lib/notifications/fixture-created'
```

- [ ] **Step 2: Notify after `recomputeGroupAndMaybeAdvance`'s insert**

Replace:

```typescript
  if (rows.length > 0) await admin.from('matches').insert(rows)
}

// Create the next knockout round once the current round is fully resolved.
```

with:

```typescript
  if (rows.length > 0) {
    const { data: inserted } = await admin
      .from('matches')
      .insert(rows)
      .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
    await notifyNewFixtures(
      admin,
      (inserted ?? []).map((m) => ({
        id: m.id,
        tournamentId,
        playerAId: m.player_a_id as string,
        playerBId: m.player_b_id,
        scheduledAt: m.scheduled_at,
        isFullDay: m.is_full_day,
      })),
    )
  }
}

// Create the next knockout round once the current round is fully resolved.
```

- [ ] **Step 3: Notify after `advanceKnockout`'s insert**

Replace:

```typescript
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  await admin.from('matches').insert(
    pairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round: nr,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
  )
}
```

with:

```typescript
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const { data: inserted } = await admin
    .from('matches')
    .insert(
      pairs.map(([a, b]) => ({
        tournament_id: tournamentId,
        round: nr,
        group_id: null,
        player_a_id: a,
        player_b_id: b,
        status: 'scheduled',
        ...schedule,
      })),
    )
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  await notifyNewFixtures(
    admin,
    (inserted ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat: notify players of new fixtures on knockout advancement"
```

---

### Task 5: Final verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (no new test files added per the spec's testing section — this feature's action-layer code follows this codebase's established untested-I/O-layer convention).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: clean build, no type errors.
