# Player Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/dashboard` with the real player dashboard: identity header, my fixtures, my tournaments, and DB-backed withdrawal requests.

**Architecture:** A middleware-guarded Server Component aggregation page runs RLS-scoped queries and maps them into a pure fixtures helper and presentational components. It reuses existing flows (result submission on match pages, registration/payment on tournament pages) instead of duplicating them. Withdrawals add one table, one zod schema, one Server Action, and a client panel; a partial unique index enforces one pending request per player.

**Tech Stack:** Next.js 14 App Router (Server + Client Components), TypeScript, Tailwind, Supabase (Postgres + RLS + server client), zod, Vitest.

## Global Constraints

- Mobile-first, design for 375px and scale up.
- Server Components by default; only `WithdrawalPanel` is `"use client"`.
- Money is a plain naira `integer`, consistent with `tournaments.prize_pool`/`registration_fee`.
- Withdrawal amount bounds live in zod: `>= 1000` (₦1,000 floor) and `<= 100_000_000` (ceiling). Account number is exactly 10 digits (NUBAN, `^\d{10}$`).
- One pending withdrawal per player, enforced three ways: partial unique index (DB), form suppression via `hasPending` (UI), and mapping Postgres `23505` to a friendly message (action).
- No wallet/balance ledger exists — the withdrawal amount is a *claim*, never shown as an "available balance".
- No KYC in v1 (v3.0); bank details entered directly.
- "Awaiting my result" flag: `status NOT IN ('completed','verified','cancelled','disputed') AND (scheduled_at <= now() OR status = 'live') AND no match_results row for this player`.
- Header stat is `goals_scored` (personal), never goal difference.
- Avatars are initial-letter circles (`bg-slate-700` circle, name's uppercased first letter) — no `<img>`/`next/image`.
- Test command: `npx vitest run <path>`. Type check: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- Each commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `withdrawal_requests` migration + regenerated types

Create the table with RLS and the one-pending-per-player index, apply it to the live Supabase project, and regenerate the TypeScript types.

**Files:**
- Create: `supabase/migrations/005_withdrawal_requests.sql`
- Modify: `lib/supabase/types.ts` (regenerated — will gain the `withdrawal_requests` table)

**Interfaces:**
- Produces: a `withdrawal_requests` table and its `Database['public']['Tables']['withdrawal_requests']` types (Row/Insert) for Tasks 3, 6, 7.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/005_withdrawal_requests.sql`:

```sql
-- Player-initiated prize withdrawal requests. Manual-resolution flow for v1;
-- Paystack Transfer automation is v3.0. Admin resolves in the admin dashboard (#9).
CREATE TABLE public.withdrawal_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer NOT NULL CHECK (amount > 0),
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'rejected')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.withdrawal_requests (player_id);
CREATE INDEX ON public.withdrawal_requests (status);

-- At most one pending request per player. Partial unique index enforces this
-- atomically (race-safe): two simultaneous submits cannot both land.
CREATE UNIQUE INDEX withdrawal_requests_one_pending_per_player
  ON public.withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- A player may file a request only for themselves, and only as pending.
CREATE POLICY "wr_own_insert" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');

-- A player sees their own requests; admins see all.
CREATE POLICY "wr_own_or_admin_read" ON public.withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());

-- Only admins resolve requests (financial action — moderators excluded).
CREATE POLICY "wr_admin_update" ON public.withdrawal_requests
  FOR UPDATE USING (public.is_admin());
```

- [ ] **Step 2: Apply the migration to the live project**

Apply via the Supabase MCP `apply_migration` tool (project `itxubrkbropttfdackmi`, name `005_withdrawal_requests`, the SQL above). This is how migrations 003/004 were applied. New table only — no change to existing schema, isolated RLS.

- [ ] **Step 3: Regenerate types**

Regenerate `lib/supabase/types.ts` via the Supabase MCP `generate_typescript_types` tool (project `itxubrkbropttfdackmi`) and overwrite the file with the result.

- [ ] **Step 4: Verify types compile and include the new table**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run` (sanity — nothing should break)
Expected: existing suite passes.
Confirm `withdrawal_requests` now appears in `lib/supabase/types.ts` (search the file).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/005_withdrawal_requests.sql lib/supabase/types.ts
git commit -m "$(cat <<'EOF'
feat: withdrawal_requests table + RLS + one-pending index

New table for player prize-withdrawal requests (manual resolution in v1).
Partial unique index enforces one pending request per player. Types regenerated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Withdrawal zod schema

**Files:**
- Create: `lib/withdrawals/schema.ts`
- Create: `lib/withdrawals/schema.test.ts`

**Interfaces:**
- Produces: `withdrawalSchema` (zod object) and `type WithdrawalInput` for Task 3.

- [ ] **Step 1: Write the failing test**

Create `lib/withdrawals/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { withdrawalSchema } from './schema'

const valid = {
  amount: '5000',
  bankName: 'GTBank',
  accountName: 'Ada Lovelace',
  accountNumber: '0123456789',
}

describe('withdrawalSchema', () => {
  it('accepts a valid request and coerces amount to a number', () => {
    const r = withdrawalSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(5000)
  })

  it('rejects amounts below the ₦1,000 floor', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, amount: '999' }).success).toBe(false)
  })

  it('accepts the floor exactly', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1000' }).success).toBe(true)
  })

  it('rejects a non-integer amount', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '1500.5' }).success).toBe(false)
  })

  it('rejects amounts over the ceiling', () => {
    expect(withdrawalSchema.safeParse({ ...valid, amount: '100000001' }).success).toBe(false)
  })

  it('rejects empty bank or account name', () => {
    expect(withdrawalSchema.safeParse({ ...valid, bankName: '   ' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountName: '' }).success).toBe(false)
  })

  it('rejects account numbers that are not exactly 10 digits', () => {
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '123456789' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '01234567890' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ ...valid, accountNumber: '12345abcde' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/withdrawals/schema.test.ts`
Expected: FAIL — cannot find module `./schema`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/withdrawals/schema.ts`:

```typescript
import { z } from 'zod'

export const withdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(1000, 'Minimum withdrawal is ₦1,000')
    .max(100_000_000, 'Amount is too large'),
  bankName: z.string().trim().min(1, 'Bank name is required').max(100, 'Bank name is too long'),
  accountName: z
    .string()
    .trim()
    .min(1, 'Account name is required')
    .max(100, 'Account name is too long'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/withdrawals/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/withdrawals/schema.ts lib/withdrawals/schema.test.ts
git commit -m "$(cat <<'EOF'
feat: withdrawal request zod schema

₦1,000 floor, ₦100M ceiling, integer amount, 10-digit NUBAN.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `requestWithdrawal` Server Action

**Files:**
- Create: `lib/withdrawals/actions.ts`

**Interfaces:**
- Consumes: `withdrawalSchema` (Task 2); the `withdrawal_requests` table (Task 1); `createClient` from `@/lib/supabase/server`.
- Produces: `requestWithdrawal(prev, formData)` and `type WithdrawalState` for Task 6.

This mirrors `lib/matches/actions.ts` (server action shape) and `lib/auth/errors.ts` (23505 mapping). The codebase does not unit-test Supabase-backed server actions; this task is verified by `tsc`/`lint` and exercised end-to-end in Task 7's build.

- [ ] **Step 1: Write the implementation**

Create `lib/withdrawals/actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withdrawalSchema } from './schema'

export type WithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestWithdrawal(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const parsed = withdrawalSchema.safeParse({
    amount: formData.get('amount'),
    bankName: formData.get('bankName') ?? '',
    accountName: formData.get('accountName') ?? '',
    accountNumber: formData.get('accountNumber') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to request a withdrawal.' }

  const { error } = await supabase.from('withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: parsed.data.bankName,
    account_number: parsed.data.accountNumber,
    account_name: parsed.data.accountName,
    status: 'pending',
  })

  if (error) {
    // Partial unique index (one pending per player) surfaces as 23505.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors (relies on the regenerated `withdrawal_requests` Insert type from Task 1).
Run: `npm run lint`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add lib/withdrawals/actions.ts
git commit -m "$(cat <<'EOF'
feat: requestWithdrawal server action

Validates with the withdrawal schema, inserts a pending row for the
signed-in user, maps 23505 (one-pending index) to a friendly message.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Fixtures pure helper

**Files:**
- Create: `lib/dashboard/fixtures.ts`
- Create: `lib/dashboard/fixtures.test.ts`

**Interfaces:**
- Produces: `DashboardMatchInput`, `DashboardFixture`, `bucketFixtures(matches, submittedMatchIds, now)` for Tasks 5 and 7.

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/fixtures.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { bucketFixtures, type DashboardMatchInput } from './fixtures'

const NOW = new Date('2026-07-07T12:00:00Z')

function m(over: Partial<DashboardMatchInput> & { id: string }): DashboardMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    round: 'group',
    opponentName: 'Opp',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}

describe('bucketFixtures — bucketing', () => {
  it('splits by status into live / upcoming / completed', () => {
    const r = bucketFixtures(
      [
        m({ id: 'l', status: 'live' }),
        m({ id: 'u', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' }),
        m({ id: 'c', status: 'completed' }),
        m({ id: 'x', status: 'cancelled' }),
      ],
      new Set(),
      NOW,
    )
    expect(r.live.map((f) => f.id)).toEqual(['l'])
    expect(r.upcoming.map((f) => f.id)).toEqual(['u'])
    expect(r.completed.map((f) => f.id).sort()).toEqual(['c', 'x'])
  })

  it('sorts upcoming ascending and completed descending by scheduledAt, nulls last', () => {
    const r = bucketFixtures(
      [
        m({ id: 'u2', status: 'scheduled', scheduledAt: '2026-09-01T10:00:00Z' }),
        m({ id: 'u1', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' }),
        m({ id: 'unull', status: 'scheduled', scheduledAt: null }),
        m({ id: 'c1', status: 'completed', scheduledAt: '2026-05-01T10:00:00Z' }),
        m({ id: 'c2', status: 'completed', scheduledAt: '2026-06-01T10:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    expect(r.upcoming.map((f) => f.id)).toEqual(['u1', 'u2', 'unull'])
    expect(r.completed.map((f) => f.id)).toEqual(['c2', 'c1'])
  })
})

describe('bucketFixtures — awaitingMyResult', () => {
  it('does NOT flag a future scheduled match', () => {
    const r = bucketFixtures(
      [m({ id: 'f', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('flags a past unplayed scheduled match with no submission', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(true)
  })

  it('does NOT flag a match the player already submitted', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(['p']),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('flags a live match regardless of scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'l', status: 'live', scheduledAt: null })], new Set(), NOW)
    expect(r.live[0].awaitingMyResult).toBe(true)
  })

  it('does NOT flag a scheduled match with a null scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'n', status: 'scheduled', scheduledAt: null })], new Set(), NOW)
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('does NOT flag a completed match', () => {
    const r = bucketFixtures(
      [m({ id: 'c', status: 'completed', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.completed[0].awaitingMyResult).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: FAIL — cannot find module `./fixtures`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/dashboard/fixtures.ts`:

```typescript
export interface DashboardMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  round: string
  opponentName: string
  tournamentTitle: string
  tournamentSlug: string
}

export interface DashboardFixture extends DashboardMatchInput {
  awaitingMyResult: boolean
}

// A match is resolved once it reaches any of these states — never "awaiting result".
// ('verified' is a match_results status, kept here defensively.)
const RESOLVED = new Set(['completed', 'verified', 'cancelled', 'disputed'])

function awaitingMyResult(
  m: DashboardMatchInput,
  submitted: Set<string>,
  now: Date,
): boolean {
  if (RESOLVED.has(m.status)) return false
  if (submitted.has(m.id)) return false
  if (m.status === 'live') return true
  if (m.scheduledAt == null) return false
  return new Date(m.scheduledAt).getTime() <= now.getTime()
}

// Ascending by ISO date string, nulls last. ISO-8601 sorts chronologically.
function ascNullsLast(a: string | null, b: string | null): number {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  return a.localeCompare(b)
}

export function bucketFixtures(
  matches: DashboardMatchInput[],
  submittedMatchIds: Set<string>,
  now: Date,
): { live: DashboardFixture[]; upcoming: DashboardFixture[]; completed: DashboardFixture[] } {
  const withFlag: DashboardFixture[] = matches.map((m) => ({
    ...m,
    awaitingMyResult: awaitingMyResult(m, submittedMatchIds, now),
  }))
  const live = withFlag.filter((f) => f.status === 'live')
  const upcoming = withFlag
    .filter((f) => f.status === 'scheduled')
    .sort((a, b) => ascNullsLast(a.scheduledAt, b.scheduledAt))
  const completed = withFlag
    .filter((f) => f.status !== 'live' && f.status !== 'scheduled')
    .sort((a, b) => ascNullsLast(b.scheduledAt, a.scheduledAt)) // descending, nulls last
  return { live, upcoming, completed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/fixtures.ts lib/dashboard/fixtures.test.ts
git commit -m "$(cat <<'EOF'
feat: dashboard fixtures bucketing helper

Buckets a player's cross-tournament matches into live/upcoming/completed
and computes the time-gated "awaiting my result" flag.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Display components (header, fixtures, tournaments)

Three presentational Server Components. No unit tests (codebase tests only `lib/`); verified by `tsc`/`lint` and Task 7's page.

**Files:**
- Create: `components/dashboard/DashboardHeader.tsx`
- Create: `components/dashboard/FixtureCard.tsx`
- Create: `components/dashboard/MyTournaments.tsx`

**Interfaces:**
- Consumes: `DashboardFixture` (Task 4); `EmptyState` from `@/components/shared/EmptyState`.
- Produces:
  - `DashboardHeader({ name, wins, losses, goalsScored })`
  - `FixtureSection({ fixtures })` and `FixtureCard({ fixture })`
  - `MyTournaments({ registrations })` and `type RegistrationRow`

- [ ] **Step 1: Create `DashboardHeader.tsx`**

```tsx
export function DashboardHeader({
  name,
  wins,
  losses,
  goalsScored,
}: {
  name: string
  wins: number
  losses: number
  goalsScored: number
}) {
  const initial = (name[0] ?? '?').toUpperCase()
  return (
    <div className="flex items-center gap-4 py-8">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xl font-bold text-white">
        {initial}
      </div>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L ·{' '}
          <span className="font-bold text-white">{goalsScored}</span> goals
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `FixtureCard.tsx`**

```tsx
import Link from 'next/link'
import type { DashboardFixture } from '@/lib/dashboard/fixtures'
import { EmptyState } from '@/components/shared/EmptyState'

function formatWhen(iso: string | null): string {
  if (!iso) return 'Time TBD'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Time TBD'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS: Record<string, { label: string; cls: string }> = {
  live: { label: '🔴 Live', cls: 'text-red-400' },
  scheduled: { label: 'Upcoming', cls: 'text-slate-400' },
  completed: { label: 'Completed', cls: 'text-emerald-400' },
  disputed: { label: 'Disputed', cls: 'text-amber-400' },
  cancelled: { label: 'Cancelled', cls: 'text-slate-500' },
}

export function FixtureCard({ fixture }: { fixture: DashboardFixture }) {
  const s = STATUS[fixture.status] ?? { label: fixture.status, cls: 'text-slate-400' }
  return (
    <Link
      href={`/matches/${fixture.id}`}
      className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">vs {fixture.opponentName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fixture.tournamentTitle} · {formatWhen(fixture.scheduledAt)}
          </p>
        </div>
        {fixture.awaitingMyResult ? (
          <span className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white">
            Submit result →
          </span>
        ) : (
          <span className={`shrink-0 text-xs font-semibold ${s.cls}`}>{s.label}</span>
        )}
      </div>
    </Link>
  )
}

export function FixtureSection({
  fixtures,
}: {
  fixtures: { live: DashboardFixture[]; upcoming: DashboardFixture[]; completed: DashboardFixture[] }
}) {
  const total = fixtures.live.length + fixtures.upcoming.length + fixtures.completed.length
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My fixtures</h2>
      {total === 0 ? (
        <EmptyState
          icon="🎮"
          title="No fixtures yet"
          body="Register for a tournament and your matches will show up here."
        />
      ) : (
        <div className="space-y-5">
          <Group label="Live" items={fixtures.live} />
          <Group label="Upcoming" items={fixtures.upcoming} />
          <Group label="Completed" items={fixtures.completed} />
        </div>
      )}
    </section>
  )
}

function Group({ label, items }: { label: string; items: DashboardFixture[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <div className="space-y-2">
        {items.map((f) => (
          <FixtureCard key={f.id} fixture={f} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `MyTournaments.tsx`**

```tsx
import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'

export interface RegistrationRow {
  id: string
  paymentStatus: string
  tournamentTitle: string
  tournamentSlug: string
}

const PAYMENT: Record<string, { label: string; cls: string }> = {
  paid: { label: '✓ Paid', cls: 'text-emerald-400' },
  pending: { label: '● Payment pending', cls: 'text-amber-400' },
  refunded: { label: 'Refunded', cls: 'text-slate-400' },
}

export function MyTournaments({ registrations }: { registrations: RegistrationRow[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My tournaments</h2>
      {registrations.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="No registrations yet"
          body="Browse tournaments and register to compete."
        />
      ) : (
        <div className="space-y-2">
          {registrations.map((r) => (
            <RegistrationCard key={r.id} reg={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function RegistrationCard({ reg }: { reg: RegistrationRow }) {
  const p = PAYMENT[reg.paymentStatus] ?? { label: reg.paymentStatus, cls: 'text-slate-400' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <Link
          href={`/tournaments/${reg.tournamentSlug}`}
          className="block truncate font-bold text-white hover:text-violet-300"
        >
          {reg.tournamentTitle}
        </Link>
        <p className={`mt-0.5 text-xs font-semibold ${p.cls}`}>{p.label}</p>
      </div>
      {reg.paymentStatus === 'pending' && (
        <Link
          href={`/tournaments/${reg.tournamentSlug}`}
          className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          Complete registration →
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: clean for these files.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/DashboardHeader.tsx components/dashboard/FixtureCard.tsx components/dashboard/MyTournaments.tsx
git commit -m "$(cat <<'EOF'
feat: dashboard header, fixtures, and tournaments components

Initial-circle identity header (W-L-goals), fixture cards with
submit-result affordance, registration cards with payment status.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `WithdrawalPanel` client component

**Files:**
- Create: `components/dashboard/WithdrawalPanel.tsx`

**Interfaces:**
- Consumes: `requestWithdrawal`, `type WithdrawalState` (Task 3); `EmptyState`.
- Produces: `WithdrawalPanel({ requests, hasPending })` and `type WithdrawalRow` for Task 7.

- [ ] **Step 1: Create `WithdrawalPanel.tsx`**

```tsx
'use client'
import type { InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { requestWithdrawal, type WithdrawalState } from '@/lib/withdrawals/actions'

export interface WithdrawalRow {
  id: string
  amount: number
  bank_name: string
  account_number: string
  account_name: string
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

function formatNaira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function WithdrawalPanel({
  requests,
  hasPending,
}: {
  requests: WithdrawalRow[]
  hasPending: boolean
}) {
  const [state, formAction] = useFormState<WithdrawalState, FormData>(requestWithdrawal, undefined)
  const showPendingMessage = hasPending || state?.success

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Withdrawals</h2>

      {showPendingMessage ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
          Request pending — we&apos;ll be in touch once it&apos;s reviewed.
        </div>
      ) : (
        <form
          action={formAction}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
        >
          <Field name="amount" label="Amount (₦)" type="number" min={1000} placeholder="1000" />
          <Field name="bankName" label="Bank name" placeholder="e.g. GTBank" />
          <Field
            name="accountNumber"
            label="Account number"
            inputMode="numeric"
            placeholder="10-digit NUBAN"
          />
          <Field name="accountName" label="Account name" placeholder="Name on the account" />
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
          >
            Request withdrawal
          </button>
        </form>
      )}

      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function Field({
  name,
  label,
  type = 'text',
  ...rest
}: { name: string; label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        {...rest}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}

function RequestRow({ req }: { req: WithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at)
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bank_name} · {req.account_number}
        {when ? ` · ${when}` : ''}
      </p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/WithdrawalPanel.tsx
git commit -m "$(cat <<'EOF'
feat: WithdrawalPanel client component

Request form (suppressed when a pending request exists) plus the
player's request history with status and timestamps.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Dashboard page + wiring

Replace the placeholder page, wire the queries and components, remove the stale gitkeep, mark the roadmap done, and build.

**Files:**
- Modify (replace): `app/dashboard/page.tsx`
- Delete: `app/(auth)/dashboard/.gitkeep`
- Modify: `ROADMAP.md` (task #8 status ⬜ → ✅)

**Interfaces:**
- Consumes: `bucketFixtures`/`DashboardMatchInput` (Task 4), `DashboardHeader`/`FixtureSection` (Task 5), `MyTournaments`/`RegistrationRow` (Task 5), `WithdrawalPanel`/`WithdrawalRow` (Task 6), `createClient` from `@/lib/supabase/server`.

- [ ] **Step 1: Replace the page**

Overwrite `app/dashboard/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bucketFixtures, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { FixtureSection } from '@/components/dashboard/FixtureCard'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { WithdrawalPanel, type WithdrawalRow } from '@/components/dashboard/WithdrawalPanel'

export const metadata: Metadata = { title: 'Dashboard · SentinelX Esports' }

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstTournament(t: TournamentRef): { title: string; slug: string } | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const [profileRes, matchesRes, resultsRes, regsRes, wrRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, wins, losses, goals_scored')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase
      .from('tournament_registrations')
      .select('id, payment_status, registered_at, tournament:tournaments(title, slug, status)')
      .eq('player_id', user.id)
      .order('registered_at', { ascending: false }),
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at',
      )
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
  ])

  const profile = profileRes.data
  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const matches: DashboardMatchInput[] = ((matchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const mm = raw as {
      id: string
      status: string
      scheduled_at: string | null
      round: string
      player_a_id: string
      player_b_id: string
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
    }
    const opponent = mm.player_a_id === user.id ? mm.player_b : mm.player_a
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      round: mm.round,
      opponentName: nameOf(opponent),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())

  const registrations: RegistrationRow[] = ((regsRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const withdrawals = (wrRes.data ?? []) as WithdrawalRow[]
  const hasPending = withdrawals.some((w) => w.status === 'pending')

  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? 'Player'

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <DashboardHeader
        name={displayName}
        wins={profile?.wins ?? 0}
        losses={profile?.losses ?? 0}
        goalsScored={profile?.goals_scored ?? 0}
      />
      <FixtureSection fixtures={fixtures} />
      <MyTournaments registrations={registrations} />
      <WithdrawalPanel requests={withdrawals} hasPending={hasPending} />
    </div>
  )
}
```

- [ ] **Step 2: Remove the stale placeholder**

```bash
git rm "app/(auth)/dashboard/.gitkeep"
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites, including the new schema and fixtures tests.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds and `/dashboard` appears in the route list (a dynamic `ƒ` route, since it reads the session).

- [ ] **Step 6: Mark the roadmap task done**

In `ROADMAP.md`, change the task #8 row status from `⬜` to `✅`:

```markdown
| 8 | Player Dashboard — fixtures, submit results, withdrawals | `/dashboard` | ✅ |
```

- [ ] **Step 7: Commit**

```bash
git add "app/dashboard/page.tsx" ROADMAP.md
git commit -m "$(cat <<'EOF'
feat: player dashboard page (v1.0 #8)

Identity header, my fixtures, my tournaments, and withdrawals wired to
RLS-scoped queries and the pure fixtures helper. Removes the stale
(auth)/dashboard placeholder. Marks roadmap #8 done.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `withdrawal_requests` table + RLS + one-pending index, applied to live DB, types regenerated → Task 1. ✅
- Withdrawal schema: ₦1,000 floor, ₦100M ceiling, integer, 10-digit NUBAN → Task 2. ✅
- `requestWithdrawal` action: validate, insert pending, 23505 → friendly, `revalidatePath` → Task 3. ✅
- Fixtures helper: bucketing + time-gated `awaitingMyResult` (all mandated cases) → Task 4. ✅
- Light identity header (W–L–goals_scored, no Sentinel Score) → Task 5. ✅
- Fixtures section with submit-result affordance linking to `/matches/[id]` → Tasks 5, 7. ✅
- My tournaments with payment status + complete-registration nudge → Task 5. ✅
- Withdrawal panel: form suppressed when `hasPending`, request history → Task 6. ✅
- Page: five parallel RLS-scoped queries, opponent derivation, `hasPending`, redirect guard → Task 7. ✅
- Remove stale `(auth)/dashboard/.gitkeep`; ROADMAP #8 done → Task 7. ✅
- Real empty states per section → Tasks 5, 6. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every code step has full code. ✅

**Type consistency:** `DashboardMatchInput`/`DashboardFixture` (Task 4) consumed by Tasks 5 & 7. `RegistrationRow` defined in `MyTournaments.tsx` (Task 5), imported by Task 7. `WithdrawalRow` defined in `WithdrawalPanel.tsx` (Task 6), imported by Task 7. `WithdrawalState` from Task 3 consumed by Task 6. `bucketFixtures(matches, submittedMatchIds, now)` signature identical across Tasks 4, 5-test, 7. `requestWithdrawal(prev, formData)` matches the `useFormState` usage in Task 6. Column names (`payment_status`, `scheduled_at`, `player_a_id`, `submitted_by`, `match_id`) verified against `lib/supabase/types.ts`. ✅

Note: the spec says the withdrawal insert can hit the one-pending index; the UI normally prevents a second submit (form suppressed), so 23505 is the race/edge net — both the UI guard (Task 6) and the action mapping (Task 3) are present, matching the spec's three-layer rule.
