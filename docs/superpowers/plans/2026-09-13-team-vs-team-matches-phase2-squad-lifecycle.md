# Team-vs-Team Matches — Phase 2: Squad Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a squad tournament (`entry_unit = 'squad'`) a working roster lifecycle — self-serve
create/invite/join/pay, admin-arranged auto-grouping of solo paid registrants, `forming` →
`complete`, and a refund for any squad still `forming` when registration closes — so a Battle
Royale Duo/Squad tournament can be run end to end, and the same tables are ready for Phase 3
(team-vs-team bracket generation) to build on.

**Architecture:** Two new pure-logic modules (`squad-lifecycle.ts`, `squad-refund.ts` — invite
codes, auto-grouping, refund math), one plain shared module (`squad-membership.ts` — the
"payment just confirmed, finish joining the squad" step, called from every place a registration
becomes `paid`), one Server Actions file (`squad-actions.ts` — create/join/move/remove), small
additive changes to the existing registration flow (`actions.ts`, `confirm.ts`,
`bracket-admin-actions.ts`, `entrants.ts`), and UI on both the player registration form and a new
admin squad-review screen. Every change is additive — the `entry_unit = 'solo'` path in every
touched file keeps executing exactly the code it executes today.

**Tech Stack:** Next.js Server Actions, Supabase (admin + RLS-scoped clients), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md` — this plan
implements §5 ("Squad lifecycle") and the relevant parts of §9 ("UI"), scoped to what §11
("Phasing") calls phase 2. It also depends on Phase 1
(`docs/superpowers/plans/2026-09-13-team-vs-team-matches-phase1-schema.md`) being merged first —
`squads`/`squad_members`/`tournament_entrants` already exist from the multi-format-tournaments
spec (2026-09-09) and need no further schema change; Phase 1 only affects `matches`/
`group_memberships`, which this phase never touches.

## Global Constraints

- Squad tables (`squads`, `squad_members`) already exist — see
  `supabase/migrations/20260909091000_tournament_entrants.sql`. Do not re-create them.
- `squads.status` is one of `'forming' | 'complete' | 'withdrawn'` — never invent a fourth value.
- A squad is `'complete'` **only** when it holds exactly `tournaments.squad_size` members — never
  a range. There is no such thing as a partial team squad (spec §5.2).
- Writes to `squads`/`squad_members` go through the admin (service-role) client only — both
  tables are `is_staff()`-gated for writes and public-read (migration `20260909091000`). Never
  attempt a client-side write to either table.
- Financial actions (refunds, credits) require `requireAdmin()`, never just `requireStaff()` —
  per CLAUDE.md, a moderator has "no financial actions."
- This codebase's Supabase-backed Server Actions are **not** unit-tested with mocks (confirmed by
  the existing convention in `lib/tournaments/bracket-admin-actions.test.ts`) — only their pure
  logic gets a Vitest unit test; the actions themselves are verified by a manual/staging dry run
  (§12 of the spec, Task 13 below).
- `registerForTournament`'s existing four branches (waiver / zero-fee / coin-discount-to-zero /
  Paystack) must keep producing byte-identical behavior for `entry_unit = 'solo'` tournaments —
  every edit below is additive (`if (squadId) { ... }`), never a restructure of the existing
  branch logic.

---

## File Structure

- **Create:** `supabase/migrations/20260913150000_squad_join_tracking.sql` — one new nullable
  column on `tournament_registrations`.
- **Create:** `lib/tournaments/squad-lifecycle.ts` — pure: invite code generation/validation,
  auto-grouping with leftovers, squad naming.
- **Create:** `lib/tournaments/squad-lifecycle.test.ts`
- **Create:** `lib/tournaments/squad-schema.ts` — Zod: squad name, invite code.
- **Create:** `lib/tournaments/squad-membership.ts` — plain module: `finalizeSquadJoin`,
  `maybeCompleteSquad`, `uniqueInviteCode` — the shared "a registration just became paid" step,
  imported by both `actions.ts` and `confirm.ts`.
- **Create:** `lib/tournaments/squad-refund.ts` — plain module: `formingSquadRefunds` (pure),
  `refundFormingSquads` (DB).
- **Create:** `lib/tournaments/squad-refund.test.ts`
- **Create:** `lib/tournaments/squad-actions.ts` — `'use server'`: `createSquad`,
  `lookupSquadByCode`, `moveSquadMember`, `removeSquadMember`.
- **Create:** `lib/tournaments/squad-share.ts` — WhatsApp invite-code share text, mirrors
  `lib/community/whatsapp.ts`.
- **Modify:** `lib/tournaments/entrants.ts` — add `squadEntrantRows()`.
- **Modify:** `lib/tournaments/entrants.test.ts`
- **Modify:** `lib/tournaments/actions.ts` — `registerForTournament` learns an optional
  `squadId`.
- **Modify:** `lib/tournaments/confirm.ts` — `confirmRegistration` calls `finalizeSquadJoin`.
- **Modify:** `lib/tournaments/bracket-admin-actions.ts` — `closeRegistration`'s
  `points_race` + `entry_unit = 'squad'` branch; add `createSquadEntrants`,
  `autoGroupRemainingPlayers`.
- **Modify:** `components/tournament/RegistrationPanel.tsx` — squad create/join flow, squad
  status card.
- **Create:** `components/tournament/SquadEntryFlow.tsx`
- **Modify:** `app/[locale]/(public)/tournaments/[slug]/page.tsx` — thread `entry_unit`,
  `squad_size`, `mySquad`.
- **Create:** `components/admin/SquadAssemblyReview.tsx`
- **Create:** `app/[locale]/admin/tournaments/[id]/squads/page.tsx`

---

### Task 1: Track which squad a pending registration is joining

A player picks (or creates) a squad *before* paying. For the synchronous payment paths (waiver /
free / coin-discount-to-zero) that's not a problem — payment confirms in the same function call.
For the Paystack path, though, payment confirms later, in `confirmRegistration`, which only ever
receives a bare `reference` string — it has no way to know which squad the player meant to join
unless that intent was written down when the `pending` row was created. This column is that
memory.

**Files:**
- Create: `supabase/migrations/20260913150000_squad_join_tracking.sql`

**Interfaces:**
- Produces: `tournament_registrations.joining_squad_id` (nullable `uuid references
  public.squads(id)`). Task 6 writes it; Task 7 reads it.

- [ ] **Step 1: Write and apply the migration**

```sql
-- A player chooses a squad to join before they pay (self-serve invite-code
-- flow, spec §5.1). The synchronous registration paths (waiver/free/coin-
-- discount-to-zero) can act on that choice immediately — the Paystack path
-- can't, because confirmRegistration only ever receives a bare reference
-- string. This column carries the choice from registerForTournament forward
-- to whichever function actually flips payment_status to 'paid'.
ALTER TABLE public.tournament_registrations
  ADD COLUMN joining_squad_id uuid REFERENCES public.squads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tournament_registrations.joining_squad_id IS
  'Squad this registration is joining, if any (entry_unit=squad self-serve). Consumed once by finalizeSquadJoin() when payment_status becomes paid — see lib/tournaments/squad-membership.ts.';
```

Apply via `mcp__claude_ai_Supabase__apply_migration` (preferred) or `npx supabase db push`, same
as Phase 1 Task 1 Step 2.

- [ ] **Step 2: Regenerate types and verify the suite is still green**

```bash
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
npm run test
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260913150000_squad_join_tracking.sql lib/supabase/types.ts
git commit -m "feat(tournaments): track which squad a pending registration is joining

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 2: Squad-lifecycle pure logic — invite codes and auto-grouping

**Files:**
- Create: `lib/tournaments/squad-lifecycle.ts`
- Create: `lib/tournaments/squad-lifecycle.test.ts`

**Interfaces:**
- Produces: `generateInviteCode(rng?)`, `isValidInviteCodeShape(code)`,
  `autoGroupIntoSquads(playerIds, teamSize, rng?)` → `{ groups: string[][]; leftover: string[] }`,
  `squadNameFor(n)`. Task 5 (`squad-schema.ts`) consumes `isValidInviteCodeShape`. Task 9
  (`bracket-admin-actions.ts`) consumes `autoGroupIntoSquads` and `squadNameFor`. Task 4
  (`squad-membership.ts`) consumes `generateInviteCode`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { generateInviteCode, isValidInviteCodeShape, autoGroupIntoSquads, squadNameFor } from './squad-lifecycle'

describe('generateInviteCode', () => {
  it('produces an 8-character code from the unambiguous alphabet', () => {
    const code = generateInviteCode(() => 0.5)
    expect(code).toHaveLength(8)
    expect(isValidInviteCodeShape(code)).toBe(true)
  })

  it('never emits an easily-confused character', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode(() => i / 50)
      expect(code).not.toMatch(/[0O1IL]/)
    }
  })
})

describe('isValidInviteCodeShape', () => {
  it('accepts an 8-char uppercase code from the alphabet', () => {
    expect(isValidInviteCodeShape('ABCDEFGH')).toBe(true)
  })
  it('rejects the wrong length, lowercase, or a banned character', () => {
    expect(isValidInviteCodeShape('ABCDEFG')).toBe(false)
    expect(isValidInviteCodeShape('abcdefgh')).toBe(false)
    expect(isValidInviteCodeShape('ABCDEFG0')).toBe(false)
  })
})

describe('autoGroupIntoSquads', () => {
  it('splits an exact multiple of teamSize into full groups with no leftover', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4, () => 0.5)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(4)
    expect(groups[1]).toHaveLength(4)
    expect(leftover).toHaveLength(0)
  })

  it('surfaces players that do not fill a final group as leftover, never as an undersized group', () => {
    const players = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4, () => 0.5)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.length === 4)).toBe(true)
    expect(leftover).toHaveLength(2)
  })

  it('every player appears in exactly one group or the leftover list', () => {
    const players = Array.from({ length: 11 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4)
    const seen = [...groups.flat(), ...leftover].sort()
    expect(seen).toEqual([...players].sort())
  })

  it('returns everyone as leftover when teamSize is not positive', () => {
    const { groups, leftover } = autoGroupIntoSquads(['a', 'b'], 0)
    expect(groups).toEqual([])
    expect(leftover).toEqual(['a', 'b'])
  })
})

describe('squadNameFor', () => {
  it('numbers squads sequentially', () => {
    expect(squadNameFor(1)).toBe('Squad 1')
    expect(squadNameFor(12)).toBe('Squad 12')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/squad-lifecycle.test.ts`
Expected: FAIL — `squad-lifecycle.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
// Squad-lifecycle pure logic — invite codes and admin-arranged auto-grouping.
// No IO here; everything DB-facing (uniqueness, actual squad rows) lives in
// squad-membership.ts and bracket-admin-actions.ts.

// Excludes 0/O/1/I/L — a code shared over WhatsApp gets retyped by hand, and
// those pairs are the ones people misread.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const INVITE_CODE_LENGTH = 8

export function generateInviteCode(rng: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(rng() * INVITE_CODE_ALPHABET.length)]
  }
  return code
}

export function isValidInviteCodeShape(code: string): boolean {
  return new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`).test(code)
}

// Fisher-Yates, then chop into fixed-size chunks. Whatever doesn't fill a
// final chunk is leftover, never forced into an undersized squad — a team
// squad has no size range to grow into (spec §5.2), unlike a BR group.
export function autoGroupIntoSquads(
  playerIds: string[],
  teamSize: number,
  rng: () => number = Math.random,
): { groups: string[][]; leftover: string[] } {
  if (teamSize <= 0) return { groups: [], leftover: [...playerIds] }
  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const groups: string[][] = []
  let i = 0
  for (; i + teamSize <= shuffled.length; i += teamSize) groups.push(shuffled.slice(i, i + teamSize))
  return { groups, leftover: shuffled.slice(i) }
}

export function squadNameFor(n: number): string {
  return `Squad ${n}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/squad-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/squad-lifecycle.ts lib/tournaments/squad-lifecycle.test.ts
git commit -m "feat(tournaments): squad invite-code and auto-grouping pure logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 3: Squad entrant rows

**Files:**
- Modify: `lib/tournaments/entrants.ts`
- Modify: `lib/tournaments/entrants.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `squadEntrantRows(tournamentId, seeds)` where `seeds: { squadId: string; displayName:
  string }[]`, returning `SquadEntrantRow[]` shaped for a `tournament_entrants` insert (`kind:
  'squad'`). Task 9 (`createSquadEntrants` in `bracket-admin-actions.ts`) calls this directly.

- [ ] **Step 1: Read the existing test file, then add the failing test**

Read `lib/tournaments/entrants.test.ts` first to match its existing style, then append:

```typescript
import { squadEntrantRows } from './entrants'

describe('squadEntrantRows', () => {
  it('builds one row per squad, kind squad', () => {
    const rows = squadEntrantRows('t1', [
      { squadId: 's1', displayName: 'Lagos Vipers' },
      { squadId: 's2', displayName: 'Abuja Falcons' },
    ])
    expect(rows).toEqual([
      { tournament_id: 't1', kind: 'squad', squad_id: 's1', display_name: 'Lagos Vipers', status: 'active' },
      { tournament_id: 't1', kind: 'squad', squad_id: 's2', display_name: 'Abuja Falcons', status: 'active' },
    ])
  })

  it('drops a duplicate squad id rather than letting the UNIQUE constraint abort the insert', () => {
    const rows = squadEntrantRows('t1', [
      { squadId: 's1', displayName: 'Lagos Vipers' },
      { squadId: 's1', displayName: 'Lagos Vipers' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('falls back to a placeholder name for a blank display name', () => {
    const rows = squadEntrantRows('t1', [{ squadId: 's1', displayName: '  ' }])
    expect(rows[0].display_name).toBe('Squad')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/entrants.test.ts`
Expected: FAIL — `squadEntrantRows` is not exported yet.

- [ ] **Step 3: Implement**

Append to `lib/tournaments/entrants.ts` (after `soloEntrantRows`):

```typescript
export interface SquadEntrantSeed {
  squadId: string
  displayName: string
}

export interface SquadEntrantRow {
  tournament_id: string
  kind: 'squad'
  squad_id: string
  display_name: string
  status: 'active'
}

// One per completed squad — the sibling this file's own top-of-file comment
// already named ("one per completed squad for a squad tournament (phase 5)"),
// now built.
export function squadEntrantRows(tournamentId: string, seeds: SquadEntrantSeed[]): SquadEntrantRow[] {
  const seen = new Set<string>()
  const rows: SquadEntrantRow[] = []

  for (const s of seeds) {
    if (seen.has(s.squadId)) continue
    seen.add(s.squadId)
    rows.push({
      tournament_id: tournamentId,
      kind: 'squad',
      squad_id: s.squadId,
      display_name: s.displayName.trim() || 'Squad',
      status: 'active',
    })
  }

  return rows
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/entrants.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/entrants.ts lib/tournaments/entrants.test.ts
git commit -m "feat(tournaments): squadEntrantRows — one tournament_entrants row per complete squad

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 4: Squad refund math

A squad still `forming` when registration closes is refunded in full and dropped (spec §5.3).
The amount owed mirrors two existing rules: `refundRegistration`'s admin-actions.ts math
(registration fee minus whatever coin discount already applied) and
`refundAbandonedCoinDiscounts`'s coin-reversal rule — a forming squad at close is functionally an
abandoned checkout, just discovered at a different trigger than that function's 1-hour sweep.

**Files:**
- Create: `lib/tournaments/squad-refund.ts`
- Create: `lib/tournaments/squad-refund.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `formingSquadRefunds(members, registrationFee)` (pure) and `refundFormingSquads(admin,
  tournamentId)` (DB). Task 9 (`closeRegistration`) calls `refundFormingSquads`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { formingSquadRefunds } from './squad-refund'

describe('formingSquadRefunds', () => {
  it('refunds the full fee for a plain paid member', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 500, coinsUsed: 0 }])
  })

  it('refunds cash net of a coin discount, and reverses the coins separately', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 500, coinDiscountNaira: 250 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 250, coinsUsed: 500 }])
  })

  it('skips a member whose registration never paid', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'pending', feeWaived: false, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([])
  })

  it('skips a fee-waived member — nothing was actually paid', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: true, coinsUsed: 0, coinDiscountNaira: 0 }],
      500,
    )
    expect(refunds).toEqual([])
  })

  it('still reverses a full-price coin discount even though cash owed is zero', () => {
    const refunds = formingSquadRefunds(
      [{ playerId: 'p1', registrationId: 'r1', paymentStatus: 'paid', feeWaived: false, coinsUsed: 1000, coinDiscountNaira: 500 }],
      500,
    )
    expect(refunds).toEqual([{ playerId: 'p1', registrationId: 'r1', cashNaira: 0, coinsUsed: 1000 }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/squad-refund.test.ts`
Expected: FAIL — `squad-refund.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from '@/lib/wallet/service'
import { recordCoinTransaction } from '@/lib/coins/service'

type Admin = ReturnType<typeof createAdminClient>

export interface SquadMemberPaymentInfo {
  playerId: string
  registrationId: string
  paymentStatus: string
  feeWaived: boolean
  coinsUsed: number
  coinDiscountNaira: number
}

export interface FormingSquadRefund {
  playerId: string
  registrationId: string
  cashNaira: number
  coinsUsed: number
}

// Pure: decide what each paid member of a dropped forming squad is owed back.
// Mirrors refundRegistration's math (lib/tournaments/admin-actions.ts) and
// refundAbandonedCoinDiscounts' coin-reversal rule
// (lib/tournaments/coin-discount-refund.ts) — a forming squad at close is
// functionally an abandoned checkout, just discovered at a different trigger.
export function formingSquadRefunds(
  members: SquadMemberPaymentInfo[],
  registrationFee: number,
): FormingSquadRefund[] {
  return members
    .filter((m) => m.paymentStatus === 'paid' && !m.feeWaived)
    .map((m) => ({
      playerId: m.playerId,
      registrationId: m.registrationId,
      cashNaira: Math.max(0, registrationFee - m.coinDiscountNaira),
      coinsUsed: m.coinsUsed,
    }))
    .filter((r) => r.cashNaira > 0 || r.coinsUsed > 0)
}

// Refunds and drops every squad still 'forming' for a tournament — the
// close-time rule spec §5.3 commits to regardless of which path formed the
// squad (an admin-arranged squad is never 'forming', so this only ever fires
// on an abandoned self-serve squad).
export async function refundFormingSquads(admin: Admin, tournamentId: string): Promise<{ refundedSquads: number }> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()
  const registrationFee = tournament?.registration_fee ?? 0

  const { data: forming } = await admin
    .from('squads')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'forming')
  const squads = forming ?? []

  for (const squad of squads) {
    const { data: members } = await admin
      .from('squad_members')
      .select('player_id, registration_id')
      .eq('squad_id', squad.id)

    const registrationIds = (members ?? []).map((m) => m.registration_id).filter((id): id is string => !!id)
    const { data: regs } =
      registrationIds.length > 0
        ? await admin
            .from('tournament_registrations')
            .select('id, payment_status, fee_waived, coins_used, coin_discount_naira')
            .in('id', registrationIds)
        : { data: [] }
    const regById = new Map((regs ?? []).map((r) => [r.id, r]))

    const paymentInfo: SquadMemberPaymentInfo[] = (members ?? [])
      .filter((m) => m.registration_id)
      .map((m) => {
        const reg = regById.get(m.registration_id as string)
        return {
          playerId: m.player_id as string,
          registrationId: m.registration_id as string,
          paymentStatus: reg?.payment_status ?? 'pending',
          feeWaived: reg?.fee_waived ?? false,
          coinsUsed: reg?.coins_used ?? 0,
          coinDiscountNaira: reg?.coin_discount_naira ?? 0,
        }
      })

    for (const refund of formingSquadRefunds(paymentInfo, registrationFee)) {
      if (refund.coinsUsed > 0) {
        await recordCoinTransaction(
          admin,
          refund.playerId,
          refund.coinsUsed,
          'entry_discount_refund',
          refund.registrationId,
          'Squad refunded — registration closed before your squad filled',
        )
      }
      if (refund.cashNaira > 0) {
        await creditWallet(
          admin,
          refund.playerId,
          refund.cashNaira,
          'admin_credit',
          refund.registrationId,
          'Squad refunded — registration closed before your squad filled',
        )
      }
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'refunded' })
        .eq('id', refund.registrationId)
        .eq('payment_status', 'paid')
    }

    await admin.from('squads').update({ status: 'withdrawn' }).eq('id', squad.id)
  }

  return { refundedSquads: squads.length }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/squad-refund.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/squad-refund.ts lib/tournaments/squad-refund.test.ts
git commit -m "feat(tournaments): refund and drop squads still forming when registration closes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 5: Squad Zod schemas

**Files:**
- Create: `lib/tournaments/squad-schema.ts`
- Create: `lib/tournaments/squad-schema.test.ts`

**Interfaces:**
- Consumes: `isValidInviteCodeShape` from `./squad-lifecycle` (Task 2).
- Produces: `squadNameSchema`, `inviteCodeSchema`. Task 6 (`squad-actions.ts`) consumes both.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { squadNameSchema, inviteCodeSchema } from './squad-schema'

describe('squadNameSchema', () => {
  it('accepts a 2-30 character name, trimmed', () => {
    expect(squadNameSchema.parse('  Lagos Vipers  ')).toBe('Lagos Vipers')
  })
  it('rejects a 1-character name', () => {
    expect(squadNameSchema.safeParse('A').success).toBe(false)
  })
  it('rejects a 31-character name', () => {
    expect(squadNameSchema.safeParse('A'.repeat(31)).success).toBe(false)
  })
})

describe('inviteCodeSchema', () => {
  it('uppercases and accepts a valid code', () => {
    expect(inviteCodeSchema.parse(' abcdefgh ')).toBe('ABCDEFGH')
  })
  it('rejects a code with a banned character', () => {
    expect(inviteCodeSchema.safeParse('ABCDEFG0').success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/squad-schema.test.ts`
Expected: FAIL — `squad-schema.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
import { z } from 'zod'
import { isValidInviteCodeShape } from './squad-lifecycle'

// 2-30 chars, matching squads_name_length in
// supabase/migrations/20260909091000_tournament_entrants.sql — this schema
// must never accept what that CHECK constraint would reject.
export const squadNameSchema = z
  .string()
  .trim()
  .min(2, 'Squad name must be at least 2 characters')
  .max(30, 'Squad name is too long')

export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidInviteCodeShape, { message: 'Enter a valid 8-character invite code' })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/squad-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/squad-schema.ts lib/tournaments/squad-schema.test.ts
git commit -m "feat(tournaments): squad name and invite code Zod schemas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 6: `squad-membership.ts` — the shared "payment just confirmed" step

This is the one piece both the self-serve join flow (Task 7) and the admin auto-group flow
(Task 9) rely on. It is deliberately **not** a Server Action (no `'use server'` directive) — it's
called from `actions.ts` (a Server Actions file), `confirm.ts` (a plain module called from two
API routes), and `squad-actions.ts` (Task 8) alike, the same way `confirm.ts` itself is shared
today.

**Files:**
- Create: `lib/tournaments/squad-membership.ts`

**Interfaces:**
- Consumes: `generateInviteCode` from `./squad-lifecycle` (Task 2).
- Produces: `finalizeSquadJoin(admin, registrationId)`, `maybeCompleteSquad(admin, squadId,
  teamSize)`, `uniqueInviteCode(admin)`. Task 7 calls `finalizeSquadJoin` from both
  `registerForTournament` and `confirmRegistration`. Task 8 calls `uniqueInviteCode` (from
  `createSquad`) and `maybeCompleteSquad` (from `moveSquadMember`). Task 9 calls
  `uniqueInviteCode` (from `autoGroupRemainingPlayers`).

- [ ] **Step 1: Implement**

No pure logic to unit-test here beyond what Task 2 already covers (`generateInviteCode` itself) —
this module is pure IO orchestration, verified in Task 13's manual dry run per this codebase's
existing convention for DB-backed code.

```typescript
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateInviteCode } from './squad-lifecycle'

type Admin = ReturnType<typeof createAdminClient>

export async function uniqueInviteCode(admin: Admin): Promise<string> {
  // Not a hard transactional guarantee — same tolerance for a vanishingly
  // unlikely race this codebase already accepts elsewhere (e.g.
  // seededPaidPlayers' non-locked capacity check). 32^8 possible codes makes
  // an actual collision astronomically unlikely; this loop exists for
  // correctness, not because a collision is expected.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    const { data } = await admin.from('squads').select('id').eq('invite_code', code).maybeSingle()
    if (!data) return code
  }
  throw new Error('Could not generate a unique invite code — please try again.')
}

// A squad that just reached its team_size flips forming -> complete. Called
// after any insert into squad_members that could have been the one that
// filled it. Conditional UPDATE (status='forming' in the WHERE) so a second
// caller racing to complete the same squad is a harmless no-op.
export async function maybeCompleteSquad(admin: Admin, squadId: string, teamSize: number): Promise<void> {
  const { count } = await admin
    .from('squad_members')
    .select('*', { count: 'exact', head: true })
    .eq('squad_id', squadId)
  if ((count ?? 0) < teamSize) return
  await admin.from('squads').update({ status: 'complete' }).eq('id', squadId).eq('status', 'forming')
}

// The self-serve join flow's completion step: registerForTournament records
// intent (tournament_registrations.joining_squad_id) *before* payment
// resolves; this turns that intent into an actual squad_members row once
// payment_status has genuinely become 'paid' — called from every place that
// happens (registerForTournament's three synchronous paths, and
// confirmRegistration's async webhook/callback path), so it must be
// idempotent against being called more than once for the same registration.
export async function finalizeSquadJoin(admin: Admin, registrationId: string): Promise<void> {
  const { data: reg } = await admin
    .from('tournament_registrations')
    .select('id, tournament_id, player_id, payment_status, joining_squad_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || !reg.joining_squad_id || reg.payment_status !== 'paid') return

  const { data: already } = await admin
    .from('squad_members')
    .select('id')
    .eq('registration_id', reg.id)
    .maybeSingle()
  if (already) return // already finalized — idempotent

  const { data: squad } = await admin
    .from('squads')
    .select('id, tournament_id, captain_id, status')
    .eq('id', reg.joining_squad_id)
    .maybeSingle()
  if (!squad || squad.tournament_id !== reg.tournament_id || squad.status !== 'forming') return

  const { data: tournament } = await admin
    .from('tournaments')
    .select('squad_size')
    .eq('id', reg.tournament_id)
    .maybeSingle()
  const teamSize = tournament?.squad_size ?? 0
  if (teamSize <= 0) return

  const { count: currentCount } = await admin
    .from('squad_members')
    .select('*', { count: 'exact', head: true })
    .eq('squad_id', squad.id)
  if ((currentCount ?? 0) >= teamSize) return // filled while this player's payment was in flight

  const { error: insErr } = await admin.from('squad_members').insert({
    squad_id: squad.id,
    tournament_id: reg.tournament_id,
    player_id: reg.player_id,
    role: reg.player_id === squad.captain_id ? 'captain' : 'member',
    registration_id: reg.id,
  })
  // squad_members_one_squad_per_tournament (player already in another squad
  // for this tournament) — silently no-op, the same light-race tolerance as
  // the count check above.
  if (insErr) return

  await maybeCompleteSquad(admin, squad.id, teamSize)
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tournaments/squad-membership.ts
git commit -m "feat(tournaments): finalizeSquadJoin — turn a paid registration's squad intent into membership

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 7: Wire squad-joining into `registerForTournament` and `confirmRegistration`

**Files:**
- Modify: `lib/tournaments/actions.ts`
- Modify: `lib/tournaments/confirm.ts`

**Interfaces:**
- Consumes: `finalizeSquadJoin` from `./squad-membership` (Task 6).
- Produces: `registerForTournament` accepts an optional `squadId` field on `formData`. Task 11's
  UI sets it.

- [ ] **Step 1: Read both files fresh**

Read `lib/tournaments/actions.ts` and `lib/tournaments/confirm.ts` in full before editing — this
task touches five separate spots in `actions.ts` and one in `confirm.ts`; line numbers below are
as of Phase 1 merge and may have drifted.

- [ ] **Step 2: Add the import and validate `squadId` up front**

In `lib/tournaments/actions.ts`, add the import:

```typescript
import { finalizeSquadJoin } from './squad-membership'
```

Extend the tournament select (currently `'id, slug, status, max_players, rules,
registration_fee, invitation_only'`) to also fetch `entry_unit, squad_size`:

```typescript
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee, invitation_only, entry_unit, squad_size')
    .eq('id', tournamentId)
    .maybeSingle()
```

Immediately after the existing `checkCanRegister` guard block (right after its closing `}`), add
squad validation:

```typescript
  // entry_unit='squad' only — the invite-code / create-squad UI never renders
  // a squadId field for a solo tournament, but never trust the client.
  const squadIdRaw = String(formData.get('squadId') ?? '')
  const squadId = squadIdRaw && tournament.entry_unit === 'squad' ? squadIdRaw : null
  if (squadIdRaw && !squadId) return { error: 'This tournament does not use squads.' }
  if (squadId) {
    const { data: squad } = await supabase
      .from('squads')
      .select('id, tournament_id, status')
      .eq('id', squadId)
      .maybeSingle()
    if (!squad || squad.tournament_id !== tournamentId) {
      return { error: 'That squad no longer exists for this tournament.' }
    }
    if (squad.status !== 'forming') return { error: 'That squad is no longer accepting members.' }
    const { count: squadMemberCount } = await supabase
      .from('squad_members')
      .select('*', { count: 'exact', head: true })
      .eq('squad_id', squadId)
    if ((squadMemberCount ?? 0) >= (tournament.squad_size ?? 0)) {
      return { error: 'That squad is already full.' }
    }
  }
```

- [ ] **Step 3: Thread `joining_squad_id` through every registration write, and finalize on every synchronous paid path**

Four edits, each additive. In the **waiver** block:

```typescript
    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: true,
      paystack_reference: null,
      joining_squad_id: squadId,
      ...regFields,
    }
    let waiverRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { error: 'Could not complete registration. Please try again.' }
      waiverRegId = inserted.id
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: true, paystack_reference: null, joining_squad_id: squadId, ...regFields })
        .eq('id', existing.id)
    }
    if (squadId && waiverRegId) await finalizeSquadJoin(admin, waiverRegId)

    redirect(`/tournaments/${tournament.slug}?paid=1`)
```

In the **zero-fee tournament** block (same shape):

```typescript
    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: false,
      paystack_reference: null,
      joining_squad_id: squadId,
      ...regFields,
    }
    let zeroFeeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { error: 'Could not complete registration. Please try again.' }
      zeroFeeRegId = inserted.id
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, joining_squad_id: squadId, ...regFields })
        .eq('id', existing.id)
    }
    if (squadId && zeroFeeRegId) await finalizeSquadJoin(admin, zeroFeeRegId)

    redirect(`/tournaments/${tournament.slug}?paid=1`)
```

In the **coin-discount-to-zero** block (same shape, plus the existing referral call stays where
it is):

```typescript
    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: false,
      paystack_reference: null,
      coins_used: coinsUsed,
      coin_discount_naira: coinDiscountNaira,
      joining_squad_id: squadId,
      ...regFields,
    }
    let coinFreeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { error: 'Could not complete registration. Please try again.' }
      coinFreeRegId = inserted.id
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields })
        .eq('id', existing.id)
    }

    await settleReferralForPaidEntry(admin, user.id, {
      registrationFee: tournament.registration_fee,
      feeWaived: false,
    })
    if (squadId && coinFreeRegId) await finalizeSquadJoin(admin, coinFreeRegId)

    redirect(`/tournaments/${tournament.slug}?paid=1`)
```

In the **Paystack (pending)** block — persist the intent, do **not** finalize yet:

```typescript
  const reference = buildReference(tournamentId, user.id)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      coins_used: coinsUsed,
      coin_discount_naira: coinDiscountNaira,
      joining_squad_id: squadId,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, coins_used: coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields })
      .eq('id', existing.id)
  }
```

- [ ] **Step 4: Finalize on the async path**

In `lib/tournaments/confirm.ts`, add the import:

```typescript
import { finalizeSquadJoin } from './squad-membership'
```

Immediately after the existing conditional claim block (`if (claimed && claimed.length > 0) {
... }`), add:

```typescript
  if (claimed && claimed.length > 0) {
    await finalizeSquadJoin(db, existing.id)
  }
```

(This sits right after the existing `settleReferralForPaidEntry` call inside that same `if`
block — both only run for the request that actually flipped the row, which is exactly when
`finalizeSquadJoin` should run too.)

- [ ] **Step 5: Regression-check the solo path**

```bash
npm run test
```

Expected: full existing suite green, zero test files modified. Then, per CLAUDE.md's Vitest
gotcha, confirm with `git worktree list` that no linked worktree under the repo root would
double-count tests before trusting that result.

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/actions.ts lib/tournaments/confirm.ts
git commit -m "feat(tournaments): registerForTournament accepts an optional squad to join

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 8: Self-serve squad actions — create, join by code, and the review-window moves

A note on scope beyond the spec's literal wording: §5.2 describes "one 'move player to a
different squad' action" for the admin review screen, mirroring `movePlayerToGroup`. A team
squad, unlike a BR group, must always be *exactly* `team_size` — there is no size range to move
into. A single "move" action can't honor that (moving a leftover player into an already-`complete`
squad would push it over size). This plan splits it into two primitives instead:
`removeSquadMember` (pulls a member out to the unassigned pool, and the squad drops back to
`forming` until it's backfilled) and `moveSquadMember` (places an unassigned player into a squad
that currently has room — typically right after a `removeSquadMember` on that same squad). Flag
this split to the spec's author during review; it's a deliberate deviation from the literal
"one action" phrasing, made to keep the exact-size invariant honest.

**Files:**
- Create: `lib/tournaments/squad-actions.ts`

**Interfaces:**
- Consumes: `squadNameSchema`, `inviteCodeSchema` (Task 5); `uniqueInviteCode`,
  `maybeCompleteSquad` (Task 6).
- Produces: `createSquad`, `lookupSquadByCode`, `moveSquadMember`, `removeSquadMember`. Task 11
  (player UI) calls `createSquad`/`lookupSquadByCode`. Task 12 (admin UI) calls
  `moveSquadMember`/`removeSquadMember`.

- [ ] **Step 1: Implement**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { squadNameSchema, inviteCodeSchema } from './squad-schema'
import { uniqueInviteCode, maybeCompleteSquad } from './squad-membership'

export type CreateSquadState = { error?: string; squadId?: string; inviteCode?: string } | undefined

// Self-serve squad creation (spec §5.1). Only creates the squad row — the
// captain still registers (and pays) through the ordinary
// registerForTournament flow with this squad's id, exactly like every other
// member.
export async function createSquad(_prev: CreateSquadState, formData: FormData): Promise<CreateSquadState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const parsedName = squadNameSchema.safeParse(formData.get('name') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  if (!parsedName.success) return { error: parsedName.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to create a squad.' }

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (!profile?.username) return { error: 'Claim a username before creating a squad.' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }
  if (tournament.entry_unit !== 'squad') return { error: 'This tournament does not use squads.' }
  if (tournament.status !== 'registration_open') return { error: 'Registration is not open.' }

  const { data: existingMembership } = await supabase
    .from('squad_members')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .maybeSingle()
  if (existingMembership) return { error: "You're already in a squad for this tournament." }

  const admin = createAdminClient()
  let inviteCode: string
  try {
    inviteCode = await uniqueInviteCode(admin)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create a squad. Please try again.' }
  }

  const { data: squad, error } = await admin
    .from('squads')
    .insert({
      tournament_id: tournamentId,
      name: parsedName.data,
      captain_id: user.id,
      invite_code: inviteCode,
      status: 'forming',
    })
    .select('id, invite_code')
    .single()
  if (error || !squad) {
    // squads_name_per_tournament_uniq — the one collision worth a friendly message.
    return {
      error: error?.code === '23505' ? 'A squad with that name already exists in this tournament.' : 'Could not create the squad. Please try again.',
    }
  }

  revalidatePath(`/tournaments`)
  return { squadId: squad.id, inviteCode: squad.invite_code }
}

export type SquadLookupState =
  | { error?: string; squad?: { id: string; name: string; memberCount: number; teamSize: number } }
  | undefined

// Read-only preview before the player commits to registering — the UI shows
// "You're joining: <name> (n/size)" before the payment step.
export async function lookupSquadByCode(_prev: SquadLookupState, formData: FormData): Promise<SquadLookupState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const parsedCode = inviteCodeSchema.safeParse(formData.get('code') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  if (!parsedCode.success) return { error: 'Enter a valid invite code.' }

  const supabase = createClient()
  const { data: tournament } = await supabase.from('tournaments').select('squad_size').eq('id', tournamentId).maybeSingle()
  if (!tournament?.squad_size) return { error: 'Tournament not found.' }

  const { data: squad } = await supabase
    .from('squads')
    .select('id, name, tournament_id, status')
    .eq('invite_code', parsedCode.data)
    .maybeSingle()
  if (!squad || squad.tournament_id !== tournamentId) return { error: 'No squad found for that code.' }
  if (squad.status !== 'forming') return { error: 'That squad is no longer accepting members.' }

  const { count } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', squad.id)
  if ((count ?? 0) >= tournament.squad_size) return { error: 'That squad is already full.' }

  return { squad: { id: squad.id, name: squad.name, memberCount: count ?? 0, teamSize: tournament.squad_size } }
}

export type SquadMoveState = { error?: string; success?: boolean } | undefined

// Pulls a player out to the unassigned pool. The squad they left can no
// longer be 'complete' (it's below team_size) — dropped back to 'forming' so
// the "every listed squad is exactly team_size" invariant stays honest until
// an admin backfills it via moveSquadMember. Admin-only (roster editing is
// staff territory, same as movePlayerToGroup for BR groups), and only while
// the tournament is registration_closed — squads are locked in once the
// tournament goes live, same pre-publish window movePlayerToGroup already
// uses for head-to-head groups.
export async function removeSquadMember(_prev: SquadMoveState, formData: FormData): Promise<SquadMoveState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  if (!tournamentId || !playerId) return { error: 'Missing player.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', tournamentId).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'Squads can only be edited before the tournament goes live.' }

  const { data: membership } = await admin
    .from('squad_members')
    .select('id, squad_id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (!membership) return { error: 'Player is not in a squad for this tournament.' }

  const { error: delErr } = await admin.from('squad_members').delete().eq('id', membership.id)
  if (delErr) return { error: `Failed to remove player: ${delErr.message}` }

  await admin.from('squads').update({ status: 'forming' }).eq('id', membership.squad_id).eq('status', 'complete')

  revalidatePath(`/admin/tournaments/${tournamentId}/squads`)
  return { success: true }
}

// Places an unassigned player (or one just pulled out by removeSquadMember)
// into a squad that currently has room. Refuses to push a squad past
// team_size — a team squad has no size range to grow into (spec §5.2).
export async function moveSquadMember(_prev: SquadMoveState, formData: FormData): Promise<SquadMoveState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const toSquadId = String(formData.get('toSquadId') ?? '')
  if (!tournamentId || !playerId || !toSquadId) return { error: 'Missing move details.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status, squad_size').eq('id', tournamentId).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'Squads can only be edited before the tournament goes live.' }
  const teamSize = t.squad_size ?? 0

  const { data: toSquad } = await admin.from('squads').select('id, tournament_id').eq('id', toSquadId).maybeSingle()
  if (!toSquad || toSquad.tournament_id !== tournamentId) return { error: 'Target squad is not part of this tournament.' }

  const { data: existingMembership } = await admin
    .from('squad_members')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (existingMembership) return { error: 'Player is already in a squad — remove them first.' }

  const { data: paidReg } = await admin
    .from('tournament_registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .eq('payment_status', 'paid')
    .maybeSingle()
  if (!paidReg) return { error: 'Player has no paid registration for this tournament.' }

  const { count: toCount } = await admin.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', toSquadId)
  if ((toCount ?? 0) >= teamSize) return { error: 'That squad is already full.' }

  const { error: insErr } = await admin.from('squad_members').insert({
    squad_id: toSquadId,
    tournament_id: tournamentId,
    player_id: playerId,
    role: 'member',
    registration_id: paidReg.id,
  })
  if (insErr) return { error: `Failed to move player: ${insErr.message}` }

  await maybeCompleteSquad(admin, toSquadId, teamSize)

  revalidatePath(`/admin/tournaments/${tournamentId}/squads`)
  return { success: true }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tournaments/squad-actions.ts
git commit -m "feat(tournaments): self-serve squad create/join and admin roster move/remove actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 9: Admin-arranged auto-grouping at `closeRegistration`

This only touches the `competition_format === 'points_race'` branch — a
`head_to_head` + `entry_unit = 'squad'` tournament can't exist yet (every such
`game_mode_formats` row is still `available = false`), so that branch is untouched, matching
spec §11 phase 2/3's split.

**Files:**
- Modify: `lib/tournaments/bracket-admin-actions.ts`

**Interfaces:**
- Consumes: `autoGroupIntoSquads`, `squadNameFor` (Task 2); `uniqueInviteCode` (Task 6);
  `refundFormingSquads` (Task 4); `squadEntrantRows` (Task 3); `requireAdmin` (already imported
  elsewhere in this codebase from `@/lib/admin/auth`).
- Produces: `createSquadEntrants(admin, tournamentId)`, `autoGroupRemainingPlayers(admin,
  tournamentId, teamSize)`. Task 12's admin review screen reads the squads/leftovers these leave
  behind.

- [ ] **Step 1: Add imports**

```typescript
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { autoGroupIntoSquads, squadNameFor } from './squad-lifecycle'
import { uniqueInviteCode } from './squad-membership'
import { refundFormingSquads } from './squad-refund'
import { squadEntrantRows } from './entrants'
```

(`requireStaff` is already imported — extend that import line rather than duplicating it.)

- [ ] **Step 2: Add `createSquadEntrants` and `autoGroupRemainingPlayers`**

Add both alongside the existing `createSoloEntrants`:

```typescript
// Squad-race equivalent of createSoloEntrants: one entrant per complete
// squad. Replaces rather than appends, same reason createSoloEntrants does.
async function createSquadEntrants(admin: Admin, tournamentId: string): Promise<void> {
  const { data: squads } = await admin
    .from('squads')
    .select('id, name')
    .eq('tournament_id', tournamentId)
    .eq('status', 'complete')

  const { error: delErr } = await admin.from('tournament_entrants').delete().eq('tournament_id', tournamentId)
  if (delErr) throw new Error(`Failed to clear existing entrants: ${delErr.message}`)

  const rows = squadEntrantRows(
    tournamentId,
    (squads ?? []).map((s) => ({ squadId: s.id, displayName: s.name })),
  )
  if (rows.length === 0) return

  const { error } = await admin.from('tournament_entrants').insert(rows)
  if (error) throw new Error(`Failed to create entrants: ${error.message}`)
}

// Admin-arranged squad formation (spec §5.2). Takes every paid registrant not
// already in a complete squad (a self-serve squad that reached team_size
// before close is left untouched), shuffles, and splits into groups of
// exactly team_size via autoGroupIntoSquads — anyone left over is returned,
// not force-assigned, for the admin review screen to place explicitly.
async function autoGroupRemainingPlayers(
  admin: Admin,
  tournamentId: string,
  teamSize: number,
): Promise<{ leftover: string[] }> {
  const { data: paidRegs } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')
    .eq('status', 'active')

  const { data: completeSquads } = await admin
    .from('squads')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'complete')
  const completeSquadIds = (completeSquads ?? []).map((s) => s.id)

  let placedIds = new Set<string>()
  if (completeSquadIds.length > 0) {
    const { data: placed } = await admin.from('squad_members').select('player_id').in('squad_id', completeSquadIds)
    placedIds = new Set((placed ?? []).map((r) => r.player_id as string))
  }

  const unplaced = (paidRegs ?? []).map((r) => r.player_id as string).filter((id) => !placedIds.has(id))
  const { groups, leftover } = autoGroupIntoSquads(unplaced, teamSize)
  if (groups.length === 0) return { leftover }

  const { count: existingSquadCount } = await admin
    .from('squads')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const inviteCode = await uniqueInviteCode(admin)
    const { data: squad } = await admin
      .from('squads')
      .insert({
        tournament_id: tournamentId,
        name: squadNameFor((existingSquadCount ?? 0) + i + 1),
        captain_id: group[0],
        invite_code: inviteCode,
        // No 'forming' wait — payment already happened via ordinary solo
        // registration (spec §5.2 step 3).
        status: 'complete',
      })
      .select('id')
      .single()
    if (!squad) continue
    await admin.from('squad_members').insert(
      group.map((playerId, idx) => ({
        squad_id: squad.id,
        tournament_id: tournamentId,
        player_id: playerId,
        role: idx === 0 ? 'captain' : 'member',
      })),
    )
  }

  return { leftover }
}
```

- [ ] **Step 3: Replace the `points_race` branch's squad guard**

Current code (inside `closeRegistration`):

```typescript
  if (t.competition_format === 'points_race') {
    // Squad entrants need the squad lifecycle (phase 5). Refusing here keeps a
    // half-built path from being reachable by accident.
    if (t.entry_unit !== 'solo') {
      return { error: 'Squad tournaments cannot be closed yet — squad registration is not built.' }
    }
    await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
    try {
      await createSoloEntrants(admin, id, seeded)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to create entrants.' }
    }
    revalidateAdmin(id)
    return { success: true }
  }
```

Replace with:

```typescript
  if (t.competition_format === 'points_race') {
    if (t.entry_unit === 'squad') {
      // Refunds + squad assembly are financial/roster-shaping actions —
      // requireStaff() above already passed, but a moderator must not reach
      // this far (CLAUDE.md: moderators get "no financial actions").
      await requireAdmin()

      const { data: squadTournament } = await admin.from('tournaments').select('squad_size').eq('id', id).maybeSingle()
      const teamSize = squadTournament?.squad_size
      if (!teamSize) return { error: 'This tournament has no squad size configured.' }

      await refundFormingSquads(admin, id)
      await autoGroupRemainingPlayers(admin, id, teamSize)

      await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
      try {
        await createSquadEntrants(admin, id)
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Failed to create entrants.' }
      }
      revalidateAdmin(id)
      revalidatePath(`/admin/tournaments/${id}/squads`)
      return { success: true }
    }

    await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
    try {
      await createSoloEntrants(admin, id, seeded)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to create entrants.' }
    }
    revalidateAdmin(id)
    return { success: true }
  }
```

Note `seeded` (from `seededPaidPlayers`) is computed unconditionally above this branch and still
guards `seeded.length < 2` before either path — that check stays meaningful for a squad
tournament too (fewer than 2 paid players can't form even one squad).

- [ ] **Step 4: Regression-check the solo and existing points-race-solo paths**

```bash
npm run test
```

Expected: full existing suite green, zero test files modified.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/bracket-admin-actions.ts
git commit -m "feat(tournaments): closeRegistration auto-groups squads for a points-race squad tournament

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 10: WhatsApp invite-code share text

**Files:**
- Create: `lib/tournaments/squad-share.ts`
- Create: `lib/tournaments/squad-share.test.ts`

**Interfaces:**
- Produces: `squadInviteShareUrl(args)`. Task 11 (player UI) calls this from the squad-created
  confirmation and the "Your squad" status card.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { squadInviteShareUrl } from './squad-share'

describe('squadInviteShareUrl', () => {
  it('builds a wa.me link carrying the squad name, code, and tournament link', () => {
    const url = squadInviteShareUrl({
      tournamentTitle: 'Free Fire Clash Squad Cup',
      tournamentSlug: 'free-fire-clash-squad-cup',
      squadName: 'Lagos Vipers',
      inviteCode: 'ABCDEFGH',
    })
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(url.replace('https://wa.me/?text=', ''))
    expect(text).toContain('Lagos Vipers')
    expect(text).toContain('ABCDEFGH')
    expect(text).toContain('/tournaments/free-fire-clash-squad-cup')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tournaments/squad-share.test.ts`
Expected: FAIL — `squad-share.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
import { SITE_URL } from '@/lib/seo/site'

// Same plain wa.me/?text= pattern as every other share surface on the
// platform (spec §9, matching lib/community/whatsapp.ts).
export function squadInviteShareUrl(args: {
  tournamentTitle: string
  tournamentSlug: string
  squadName: string
  inviteCode: string
}): string {
  const link = `${SITE_URL}/tournaments/${args.tournamentSlug}`
  const text =
    `🎮 Join my squad "${args.squadName}" for ${args.tournamentTitle} on SentinelX!\n` +
    `Invite code: ${args.inviteCode}\n${link}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tournaments/squad-share.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/squad-share.ts lib/tournaments/squad-share.test.ts
git commit -m "feat(tournaments): WhatsApp share link for a squad invite code

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 11: Player-facing UI — create/join a squad, then register

**Files:**
- Create: `components/tournament/SquadEntryFlow.tsx`
- Modify: `components/tournament/RegistrationPanel.tsx`
- Modify: `app/[locale]/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Consumes: `createSquad`, `lookupSquadByCode` (Task 8); `squadInviteShareUrl` (Task 10).
- Produces: `RegistrationPanel` accepts new props `entryUnit: 'solo' | 'squad'`, `squadSize:
  number | null`, `mySquad: { name: string; inviteCode: string; memberCount: number; teamSize:
  number } | null`.

- [ ] **Step 1: Extend the tournament page's query and squad lookup**

In `app/[locale]/(public)/tournaments/[slug]/page.tsx`, extend `getTournament`'s select to add
`entry_unit, squad_size`:

```typescript
    .select(
      'id, title, slug, description, banner_url, card_image_url, prize_pool, registration_fee, status, format, max_players, registration_end, tournament_start, tournament_end, rules, invitation_only, entry_unit, squad_size, games(name, icon_url, slug, category), game_modes(name), game_mode_formats(name), game_mode_maps(name), game_mode_match_rules(name)',
    )
```

Near where `view` is computed (the existing `resolveRegistrationView` call), add a squad lookup
that only fires when relevant:

```typescript
  let mySquad: { name: string; inviteCode: string; memberCount: number; teamSize: number } | null = null
  if (user && t.entry_unit === 'squad' && view === 'registered') {
    const { data: membership } = await supabase
      .from('squad_members')
      .select('squad_id, squads(name, invite_code)')
      .eq('tournament_id', t.id)
      .eq('player_id', user.id)
      .maybeSingle()
    if (membership) {
      const squad = Array.isArray(membership.squads) ? membership.squads[0] : membership.squads
      const { count } = await supabase
        .from('squad_members')
        .select('*', { count: 'exact', head: true })
        .eq('squad_id', membership.squad_id)
      if (squad) {
        mySquad = { name: squad.name, inviteCode: squad.invite_code, memberCount: count ?? 0, teamSize: t.squad_size ?? 0 }
      }
    }
  }
```

Pass the three new props to `<RegistrationPanel>`:

```typescript
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          entryUnit={t.entry_unit as 'solo' | 'squad'}
          squadSize={t.squad_size}
          mySquad={mySquad}
          loginHref={`/login?next=/tournaments/${t.slug}`}
          prefill={prefill}
          rules={splitRules(t.rules)}
          gameName={game?.name ?? 'Mobile Esports'}
          tournamentTitle={t.title}
          loggedIn={!!user}
          coinBalance={coinBalance}
          hasUsername={hasUsername}
        />
```

- [ ] **Step 2: `SquadEntryFlow` — create-or-join, then hand off to registration**

```typescript
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createSquad, lookupSquadByCode, type CreateSquadState, type SquadLookupState } from '@/lib/tournaments/squad-actions'
import { squadInviteShareUrl } from '@/lib/tournaments/squad-share'

type Choice = { squadId: string; squadName: string; inviteCode?: string }

export function SquadEntryFlow({
  tournamentId,
  tournamentSlug,
  tournamentTitle,
  squadSize,
  onChosen,
}: {
  tournamentId: string
  tournamentSlug: string
  tournamentTitle: string
  squadSize: number
  onChosen: (choice: Choice) => void
}) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')

  if (mode === 'choose') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setMode('create')}
          className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-white hover:border-violet-500"
        >
          Create a Squad
        </button>
        <button
          type="button"
          onClick={() => setMode('join')}
          className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-white hover:border-violet-500"
        >
          Join by Code
        </button>
      </div>
    )
  }

  if (mode === 'create') {
    return <CreateSquadForm tournamentId={tournamentId} tournamentSlug={tournamentSlug} tournamentTitle={tournamentTitle} onCreated={onChosen} onBack={() => setMode('choose')} />
  }

  return <JoinSquadForm tournamentId={tournamentId} squadSize={squadSize} onJoined={onChosen} onBack={() => setMode('choose')} />
}

function CreateSquadForm({
  tournamentId,
  tournamentSlug,
  tournamentTitle,
  onCreated,
  onBack,
}: {
  tournamentId: string
  tournamentSlug: string
  tournamentTitle: string
  onCreated: (choice: Choice) => void
  onBack: () => void
}) {
  const [state, formAction] = useFormState<CreateSquadState, FormData>(createSquad, undefined)
  const [name, setName] = useState('')

  if (state?.squadId && state.inviteCode) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-emerald-400">✓ Squad created — share your invite code:</p>
        <p className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-center text-lg font-bold tracking-widest text-white">
          {state.inviteCode}
        </p>
        <a
          href={squadInviteShareUrl({ tournamentTitle, tournamentSlug, squadName: name, inviteCode: state.inviteCode })}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs font-semibold text-emerald-400 hover:text-emerald-300"
        >
          ↗ Share on WhatsApp
        </a>
        <button
          type="button"
          onClick={() => onCreated({ squadId: state.squadId!, squadName: name, inviteCode: state.inviteCode })}
          className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
        >
          Continue to registration →
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input
        type="text"
        name="name"
        placeholder="Squad name (2-30 characters)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500"
        required
      />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300">
          ← Back
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Create Squad
        </button>
      </div>
    </form>
  )
}

function JoinSquadForm({
  tournamentId,
  squadSize,
  onJoined,
  onBack,
}: {
  tournamentId: string
  squadSize: number
  onJoined: (choice: Choice) => void
  onBack: () => void
}) {
  const [state, formAction] = useFormState<SquadLookupState, FormData>(lookupSquadByCode, undefined)

  if (state?.squad) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-300">
          You&apos;re joining <span className="font-bold text-white">{state.squad.name}</span> —{' '}
          {state.squad.memberCount}/{state.squad.teamSize} joined so far.
        </p>
        <button
          type="button"
          onClick={() => onJoined({ squadId: state.squad!.id, squadName: state.squad!.name })}
          className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
        >
          Continue to registration →
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input
        type="text"
        name="code"
        placeholder={`Invite code (${squadSize > 0 ? `${squadSize}-player squad` : 'from your captain'})`}
        maxLength={8}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-center text-sm uppercase tracking-widest text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500"
        required
      />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300">
          ← Back
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Find Squad
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Wire `SquadEntryFlow` into `RegistrationPanel`**

Read `components/tournament/RegistrationPanel.tsx` fresh (Task 7 didn't touch it, but confirm no
drift), then:

Add the new props to the top-level `RegistrationPanel` signature: `entryUnit: 'solo' | 'squad'`,
`squadSize: number | null`, `mySquad: { name: string; inviteCode: string; memberCount: number;
teamSize: number } | null`. Import `SquadEntryFlow` and `squadInviteShareUrl`.

In the `view === 'can_register' || view === 'complete_payment'` branch, before rendering
`<RegisterForm>` when `entryUnit === 'squad'` and payment hasn't started yet, gate on a chosen
squad:

```typescript
    if (entryUnit === 'squad' && view === 'can_register') {
      return (
        <div className={box}>
          <SquadPickerThenRegister
            tournamentId={tournamentId}
            slug={slug}
            fee={fee}
            prefill={prefill}
            rules={rules}
            gameName={gameName}
            tournamentTitle={tournamentTitle}
            coinBalance={coinBalance}
            squadSize={squadSize ?? 0}
          />
        </div>
      )
    }
    return (
      <div className={box}>
        <RegisterForm
          tournamentId={tournamentId}
          slug={slug}
          fee={fee}
          prefill={prefill}
          rules={rules}
          gameName={gameName}
          tournamentTitle={tournamentTitle}
          coinBalance={coinBalance}
          isCompletingPayment={view === 'complete_payment'}
        />
      </div>
    )
```

Add the small wrapper component (in the same file, below `RegisterForm`) that holds the "which
squad" choice in state and then renders the existing `RegisterForm` with a `squadId` prop:

```typescript
function SquadPickerThenRegister(props: {
  tournamentId: string
  slug: string
  fee: number
  prefill: { displayName: string; whatsapp: string }
  rules: string[]
  gameName: string
  tournamentTitle: string
  coinBalance: number
  squadSize: number
}) {
  const [choice, setChoice] = useState<{ squadId: string; squadName: string } | null>(null)

  if (!choice) {
    return (
      <SquadEntryFlow
        tournamentId={props.tournamentId}
        tournamentSlug={props.slug}
        tournamentTitle={props.tournamentTitle}
        squadSize={props.squadSize}
        onChosen={setChoice}
      />
    )
  }

  return (
    <>
      <p className="mb-3 text-center text-sm text-slate-300">
        Joining <span className="font-bold text-white">{choice.squadName}</span>
      </p>
      <RegisterForm {...props} squadId={choice.squadId} isCompletingPayment={false} />
    </>
  )
}
```

Give `RegisterForm` the optional `squadId` prop and thread it into its `<form>` as a hidden
field:

```typescript
function RegisterForm({
  tournamentId,
  slug,
  fee,
  prefill,
  rules,
  gameName,
  tournamentTitle,
  coinBalance,
  isCompletingPayment,
  squadId,
}: {
  // ...existing fields...
  squadId?: string
}) {
  // ...existing body unchanged...
  return (
    <>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        {squadId && <input type="hidden" name="squadId" value={squadId} />}
        {/* ...existing fields unchanged... */}
```

Add `import { useState } from 'react'` if not already present (it already is, for the coin tier
state), and `import { SquadEntryFlow } from './SquadEntryFlow'`.

Finally, in the `view === 'registered'` branch, show squad status when `mySquad` is present
(inserted right after the existing "✓ You're registered" line):

```typescript
        {mySquad && (
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
            <p className="text-center text-sm text-slate-300">
              Your squad: <span className="font-bold text-white">{mySquad.name}</span> —{' '}
              {mySquad.memberCount}/{mySquad.teamSize} joined
            </p>
            {mySquad.memberCount < mySquad.teamSize && (
              <>
                <p className="mt-1 text-center text-lg font-bold tracking-widest text-white">{mySquad.inviteCode}</p>
                <a
                  href={squadInviteShareUrl({ tournamentTitle, tournamentSlug: slug, squadName: mySquad.name, inviteCode: mySquad.inviteCode })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-center text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  ↗ Share invite on WhatsApp
                </a>
              </>
            )}
          </div>
        )}
```

- [ ] **Step 4: Manual smoke check**

```bash
npm run build
```

Expected: build succeeds (this task adds no new tests — it's UI wiring over already-tested
server actions and pure logic; Task 13 covers the interactive dry run).

- [ ] **Step 5: Commit**

```bash
git add components/tournament/SquadEntryFlow.tsx components/tournament/RegistrationPanel.tsx "app/[locale]/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat(tournaments): player UI to create or join a squad before registering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 12: Admin squad-assembly review screen

**Files:**
- Create: `components/admin/SquadAssemblyReview.tsx`
- Create: `app/[locale]/admin/tournaments/[id]/squads/page.tsx`

**Interfaces:**
- Consumes: `moveSquadMember`, `removeSquadMember` (Task 8).

- [ ] **Step 1: Server page — fetch squads, rosters, and unassigned leftovers**

```typescript
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SquadAssemblyReview } from '@/components/admin/SquadAssemblyReview'

export default async function AdminSquadsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const admin = createAdminClient()

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, title, status, entry_unit, squad_size')
    .eq('id', params.id)
    .maybeSingle()
  if (!tournament || tournament.entry_unit !== 'squad') notFound()

  const { data: squads } = await admin
    .from('squads')
    .select('id, name, status, captain_id')
    .eq('tournament_id', tournament.id)
    .order('name')

  const { data: members } = await admin
    .from('squad_members')
    .select('squad_id, player_id, role, profiles(username, display_name)')
    .eq('tournament_id', tournament.id)

  const { data: paidRegs } = await admin
    .from('tournament_registrations')
    .select('player_id, profiles(username, display_name)')
    .eq('tournament_id', tournament.id)
    .eq('payment_status', 'paid')
    .eq('status', 'active')

  const placedIds = new Set((members ?? []).map((m) => m.player_id))
  const unassigned = (paidRegs ?? [])
    .filter((r) => !placedIds.has(r.player_id))
    .map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      return { playerId: r.player_id as string, name: p?.display_name ?? p?.username ?? 'Player' }
    })

  const squadRows = (squads ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    members: (members ?? [])
      .filter((m) => m.squad_id === s.id)
      .map((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return { playerId: m.player_id as string, role: m.role as string, name: p?.display_name ?? p?.username ?? 'Player' }
      }),
  }))

  return (
    <SquadAssemblyReview
      tournamentId={tournament.id}
      tournamentTitle={tournament.title}
      teamSize={tournament.squad_size ?? 0}
      squads={squadRows}
      unassigned={unassigned}
    />
  )
}
```

- [ ] **Step 2: Client component — one card per squad, an unassigned pool, move/remove forms**

```typescript
'use client'
import { useFormState } from 'react-dom'
import { moveSquadMember, removeSquadMember, type SquadMoveState } from '@/lib/tournaments/squad-actions'

type SquadRow = {
  id: string
  name: string
  status: string
  members: { playerId: string; role: string; name: string }[]
}

export function SquadAssemblyReview({
  tournamentId,
  tournamentTitle,
  teamSize,
  squads,
  unassigned,
}: {
  tournamentId: string
  tournamentTitle: string
  teamSize: number
  squads: SquadRow[]
  unassigned: { playerId: string; name: string }[]
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-bold text-white">{tournamentTitle} — Squad Review</h1>
      <p className="text-sm text-slate-400">
        Every squad must be exactly {teamSize} players before this tournament can go live. To move a
        player into a full squad, remove someone from it first.
      </p>

      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="mb-2 text-sm font-bold text-amber-400">Unassigned ({unassigned.length})</h2>
          <div className="space-y-2">
            {unassigned.map((p) => (
              <UnassignedRow key={p.playerId} tournamentId={tournamentId} playerId={p.playerId} name={p.name} squads={squads} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {squads.map((squad) => (
          <SquadCard key={squad.id} tournamentId={tournamentId} squad={squad} teamSize={teamSize} />
        ))}
      </div>
    </div>
  )
}

function SquadCard({ tournamentId, squad, teamSize }: { tournamentId: string; squad: SquadRow; teamSize: number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold text-white">{squad.name}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            squad.status === 'complete' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {squad.members.length}/{teamSize}
        </span>
      </div>
      <div className="space-y-1.5">
        {squad.members.map((m) => (
          <RemoveRow key={m.playerId} tournamentId={tournamentId} playerId={m.playerId} name={m.name} role={m.role} />
        ))}
      </div>
    </div>
  )
}

function RemoveRow({ tournamentId, playerId, name, role }: { tournamentId: string; playerId: string; name: string; role: string }) {
  const [state, formAction] = useFormState<SquadMoveState, FormData>(removeSquadMember, undefined)
  return (
    <form action={formAction} className="flex items-center justify-between text-sm">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <span className="text-slate-300">
        {name} {role === 'captain' && <span className="text-violet-400">(C)</span>}
      </span>
      <button type="submit" className="text-xs font-semibold text-red-400 hover:text-red-300">
        Remove
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

function UnassignedRow({
  tournamentId,
  playerId,
  name,
  squads,
}: {
  tournamentId: string
  playerId: string
  name: string
  squads: SquadRow[]
}) {
  const [state, formAction] = useFormState<SquadMoveState, FormData>(moveSquadMember, undefined)
  return (
    <form action={formAction} className="flex items-center gap-2 text-sm">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <span className="flex-1 text-slate-300">{name}</span>
      <select name="toSquadId" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white" required>
        <option value="">Move to squad…</option>
        {squads.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.members.length})
          </option>
        ))}
      </select>
      <button type="submit" className="text-xs font-semibold text-violet-400 hover:text-violet-300">
        Move
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Smoke-build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add "app/[locale]/admin/tournaments/[id]/squads/page.tsx" components/admin/SquadAssemblyReview.tsx
git commit -m "feat(admin): squad assembly review screen — move/remove roster members before go-live

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015CNBGxj7kRKmmFEue5pVdg"
```

---

### Task 13: Full regression + manual staging dry run

**Files:** none (verification only).

- [ ] **Step 1: Full automated suite**

```bash
npm run test
```

Expected: every test green, including all of Tasks 2-10's new unit tests. First confirm via `git
worktree list` that no linked worktree would double-count results.

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Manual dry run on staging (spec §12)**

Create a test squad tournament (`entry_unit = 'squad'`, any small `squad_size` — the format
catalogue flip in Phase 7 isn't needed to test this in isolation; a staging-only
`game_mode_formats` row with `available = true` works, or temporarily flip one row and revert
after). Walk through:

1. **Self-serve squad, full:** Player A creates a squad, shares the invite code, players B/C/D
   join by code and each pays. Confirm the squad flips to `complete` the moment the 4th payment
   confirms (check `squads.status` directly, and via Paystack's test mode for the async path —
   not just the synchronous coin-discount-to-zero path).
2. **Self-serve squad, abandoned:** A second squad forms with only 2/4 paid. Admin closes
   registration. Confirm: the squad is `withdrawn`, both members' wallets were credited the
   right amount (check `wallet_transactions`), and their `tournament_registrations.payment_status`
   is `refunded`.
3. **Admin-arranged:** A handful of players register solo (no squad). Admin closes registration.
   Confirm they're auto-grouped into `complete` squads of exactly `squad_size`, any true leftover
   appears on `/admin/tournaments/[id]/squads` as unassigned, and `tournament_entrants` has one
   `kind = 'squad'` row per complete squad.
4. **Admin review moves:** On the squad review screen, remove a player from a squad (confirm it
   drops to `forming`), then move them (or an unassigned leftover) into a different squad with
   room (confirm it returns to `complete`).
5. **Solo tournament regression:** Register for an ordinary solo tournament exactly as before —
   confirm nothing about the flow changed (no squad UI appears, no `joining_squad_id` touched).

- [ ] **Step 4: Report results**

Summarize pass/fail for each of the 5 scenarios above before considering Phase 2 complete. Any
failure blocks Phase 3 (bracket generation for teams), which reads `squads`/`squad_members` as
its input.

---

## Self-Review

**Spec coverage:**
- §5.1 (self-serve create/invite/join/pay, `forming` → `complete` on paid membership) → Tasks
  4, 6, 7, 8, 11.
- §5.2 (admin-arranged auto-group, review screen, leftover handling, move) → Tasks 2, 8, 9, 12.
- §5.3 (forming squad refunded and dropped at close, regardless of path) → Tasks 4, 9.
- §9 (player dashboard create/invite/join, admin review screen in the knockout-pairing-editor
  style) → Tasks 11, 12.
- §11 phase 2 ("Usable standalone — this alone unblocks BR Duo/Squad") → the whole plan; nothing
  here depends on Phase 3.
- §12 (pure-logic unit tests for auto-grouping; money tests for refund-on-forming-at-close;
  manual dry run before a real tournament) → Tasks 2, 4, 13.

**Placeholder scan:** none found — every step carries literal code or a literal command.

**Type consistency:** `squadId` (form field name, `string | null`) is consistent across
`registerForTournament`, `createSquad`'s return, `lookupSquadByCode`'s return, and
`SquadEntryFlow`'s `onChosen` callback. `teamSize` / `squad_size` naming: the DB column and
`tournaments` select are always `squad_size`; local variables and function parameters use
`teamSize` throughout `squad-lifecycle.ts`, `squad-membership.ts`, `squad-actions.ts`, and
`bracket-admin-actions.ts` — Phase 3 should keep that same split (DB column `squad_size`, code
variable `teamSize`) rather than introducing a third name.
