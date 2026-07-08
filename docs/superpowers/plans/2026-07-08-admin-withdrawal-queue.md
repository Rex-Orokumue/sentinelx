# Admin Withdrawal Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins resolve pending withdrawal requests (mark paid / rejected with a note) from a queue, and share one naira formatter across the app.

**Architecture:** A shared `lib/format.ts` `formatNaira` replaces inline naira formatting everywhere. A `requireAdmin` action resolves a request (status guard + note rules); a client row drives it; a page shows pending (actionable) + the last 20 resolved (audit). No migration — the table/RLS/index shipped in #8. This closes #9 and all of v1.0.

**Tech Stack:** Next.js 14.2 App Router, TypeScript, Tailwind, Supabase server client, Vitest. Forms use `useFormState` from `react-dom`.

## Global Constraints

- Mobile-first; only `WithdrawalQueueRow` is `"use client"`.
- The page and the action are **`requireAdmin`** (financial; moderators excluded). Nav entry is `adminOnly: true`.
- `resolveWithdrawal`: `action` ∈ {`paid`,`rejected`}; **`rejected` requires a non-empty note**, `paid`'s note is optional; refuse unless the request is `status='pending'` (terminal once resolved).
- `formatNaira(n) = ₦ + n.toLocaleString('en-NG')`, shared from `lib/format.ts`; route all naira-display sites through it.
- Recently-resolved list is the **last 20 by `resolved_at` desc**; pending has an explicit empty state ("No pending withdrawals").
- Marks `ROADMAP.md` #9 → ✅ (this completes v1.0).
- Test: `npx vitest run <path>`. Type: `npx tsc --noEmit`. Lint: `npx next lint --file <path>`. Build: `npm run build`.
- Each commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Shared naira formatter + adopt it everywhere

**Files:**
- Create: `lib/format.ts` + `lib/format.test.ts`
- Modify: `components/dashboard/WithdrawalPanel.tsx`, `components/tournament/TournamentCard.tsx`, `components/tournament/RegistrationPanel.tsx`, `app/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Produces: `formatNaira(n: number): string` for Task 3 and the refactored sites.

- [ ] **Step 1: Write the failing test**

Create `lib/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatNaira } from './format'

describe('formatNaira', () => {
  it('prepends ₦ and groups thousands', () => {
    expect(formatNaira(1000)).toBe('₦1,000')
    expect(formatNaira(50000)).toBe('₦50,000')
    expect(formatNaira(0)).toBe('₦0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Create the formatter**

Create `lib/format.ts`:

```typescript
// Single source of truth for naira display. ₦ + Nigerian digit grouping.
export function formatNaira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt it in `WithdrawalPanel.tsx`**

In `components/dashboard/WithdrawalPanel.tsx`, delete the local `formatNaira` function:

```typescript
function formatNaira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`
}
```

and add an import at the top (after the existing imports):

```typescript
import { formatNaira } from '@/lib/format'
```

- [ ] **Step 6: Adopt it in `TournamentCard.tsx`**

Add `import { formatNaira } from '@/lib/format'` at the top. Replace:

```tsx
            ₦{t.prize_pool.toLocaleString()}
```
with
```tsx
            {formatNaira(t.prize_pool)}
```
and
```tsx
            ₦{t.registration_fee.toLocaleString()}
```
with
```tsx
            {formatNaira(t.registration_fee)}
```

- [ ] **Step 7: Adopt it in `RegistrationPanel.tsx`**

Add `import { formatNaira } from '@/lib/format'` at the top. Replace the three sites:

```tsx
          Register — ₦{fee.toLocaleString()}
```
with
```tsx
          Register — {formatNaira(fee)}
```
;
```tsx
            view === 'complete_payment' ? 'Complete payment →' : `Register — ₦${fee.toLocaleString()}`
```
with
```tsx
            view === 'complete_payment' ? 'Complete payment →' : `Register — ${formatNaira(fee)}`
```
;
```tsx
          Secure payment via Paystack. Entry fee ₦{fee.toLocaleString()}.
```
with
```tsx
          Secure payment via Paystack. Entry fee {formatNaira(fee)}.
```

- [ ] **Step 8: Adopt it in `tournaments/[slug]/page.tsx`**

Add `import { formatNaira } from '@/lib/format'` at the top. Replace the four sites:

```tsx
    `₦${t.prize_pool.toLocaleString()} prize pool. Entry ₦${t.registration_fee.toLocaleString()}. Compete on Sentinel X.`
```
with
```tsx
    `${formatNaira(t.prize_pool)} prize pool. Entry ${formatNaira(t.registration_fee)}. Compete on Sentinel X.`
```
;
```tsx
  const shareText = `${t.title} on Sentinel X — ₦${t.prize_pool.toLocaleString()} prize pool 🎮 ${SITE_URL}/tournaments/${t.slug}`
```
with
```tsx
  const shareText = `${t.title} on Sentinel X — ${formatNaira(t.prize_pool)} prize pool 🎮 ${SITE_URL}/tournaments/${t.slug}`
```
;
```tsx
        <Stat label="Prize Pool" value={`₦${t.prize_pool.toLocaleString()}`} accent />
        <Stat label="Entry Fee" value={`₦${t.registration_fee.toLocaleString()}`} />
```
with
```tsx
        <Stat label="Prize Pool" value={formatNaira(t.prize_pool)} accent />
        <Stat label="Entry Fee" value={formatNaira(t.registration_fee)} />
```

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all suites pass, including `lib/format.test.ts`.

```bash
git add lib/format.ts lib/format.test.ts components/dashboard/WithdrawalPanel.tsx components/tournament/TournamentCard.tsx components/tournament/RegistrationPanel.tsx "app/(public)/tournaments/[slug]/page.tsx"
git commit -m "$(cat <<'EOF'
refactor: shared formatNaira in lib/format.ts

Extract the naira formatter and route WithdrawalPanel, TournamentCard,
RegistrationPanel, and the tournament detail page through it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `resolveWithdrawal` action

**Files:**
- Create: `lib/withdrawals/admin-actions.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/admin/auth`), `createClient` (`@/lib/supabase/server`).
- Produces: `type WithdrawalResolveState`, `resolveWithdrawal` for Task 3.

Verified via `tsc`/`lint`; exercised by the Task 3 build.

- [ ] **Step 1: Write the implementation**

Create `lib/withdrawals/admin-actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'

export type WithdrawalResolveState = { error?: string; success?: boolean } | undefined

export async function resolveWithdrawal(
  _prev: WithdrawalResolveState,
  formData: FormData,
): Promise<WithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('withdrawal_requests')
    .update({ status: action, admin_note: note || null, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  revalidatePath('/admin/withdrawals')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file lib/withdrawals/admin-actions.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/withdrawals/admin-actions.ts
git commit -m "$(cat <<'EOF'
feat: resolveWithdrawal admin action

requireAdmin; paid/rejected with reject-note required; refuses unless
the request is still pending. Revalidates the queue + player dashboard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Queue row, page, nav, overview link, roadmap

**Files:**
- Create: `components/admin/WithdrawalQueueRow.tsx`
- Create: `app/admin/withdrawals/page.tsx`
- Modify: `lib/admin/nav.ts` (append Withdrawals, adminOnly)
- Modify: `app/admin/page.tsx` (link the Pending-withdrawals card)
- Modify: `ROADMAP.md` (#9 → ✅)

**Interfaces:**
- Consumes: `resolveWithdrawal`/`WithdrawalResolveState` (Task 2), `formatNaira` (Task 1), `requireAdmin`, `createClient`.

- [ ] **Step 1: Create the queue row**

Create `components/admin/WithdrawalQueueRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { resolveWithdrawal, type WithdrawalResolveState } from '@/lib/withdrawals/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
}

export function WithdrawalQueueRow({ req }: { req: PendingWithdrawal }) {
  const [state, action] = useFormState<WithdrawalResolveState, FormData>(resolveWithdrawal, undefined)
  return (
    <form action={action} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={req.id} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">{req.playerName}</p>
        <p className="shrink-0 font-black text-white">{formatNaira(req.amount)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bankName} · {req.accountNumber} · {req.accountName}
      </p>
      <textarea
        name="note"
        rows={2}
        placeholder="Note (required to reject; optional transfer ref if paid)"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          name="action"
          value="paid"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          Mark paid
        </button>
        <button
          type="submit"
          name="action"
          value="rejected"
          className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Reject
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create the withdrawals page**

Create `app/admin/withdrawals/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatNaira } from '@/lib/format'
import { WithdrawalQueueRow, type PendingWithdrawal } from '@/components/admin/WithdrawalQueueRow'

export const metadata: Metadata = { title: 'Withdrawals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'Player'
}
function firstP(p: ProfileRef | ProfileRef[]): ProfileRef {
  return Array.isArray(p) ? p[0] ?? null : p
}
function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const RESOLVED_STATUS: Record<string, string> = {
  paid: 'text-emerald-400',
  rejected: 'text-red-400',
}

export default async function AdminWithdrawalsPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: pendingData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select('id, amount, bank_name, account_number, account_name, profiles(username, display_name)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .neq('status', 'pending')
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const pending: PendingWithdrawal[] = ((pendingData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      bank_name: string
      account_number: string
      account_name: string
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountName: w.account_name,
    }
  })

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      status: w.status,
      adminNote: w.admin_note,
      resolvedAt: w.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-4 text-base font-bold text-white">Pending withdrawals</h2>
        {pending.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No pending withdrawals.
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((req) => (
              <WithdrawalQueueRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Recently resolved</h2>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-bold text-white">{r.playerName}</p>
                  <p className="shrink-0 text-sm">
                    {formatNaira(r.amount)}{' '}
                    <span className={`font-semibold ${RESOLVED_STATUS[r.status] ?? 'text-slate-400'}`}>
                      {r.status}
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {fmtDate(r.resolvedAt)}
                  {r.adminNote ? ` · ${r.adminNote}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Append the Withdrawals nav entry (admin-only)**

In `lib/admin/nav.ts`, extend `ADMIN_NAV`:

```typescript
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
]
```

- [ ] **Step 4: Link the Overview Pending-withdrawals card**

In `app/admin/page.tsx`, give the admin-only card an href:

```tsx
        {ctx.isAdmin && (
          <StatCard label="Pending withdrawals" count={pendingWithdrawals.count ?? 0} href="/admin/withdrawals" />
        )}
```

- [ ] **Step 5: Mark the roadmap task done**

In `ROADMAP.md`, change the task #9 row status from `⬜` to `✅`:

```markdown
| 9 | Admin Dashboard — tournaments, result verification, flags | `/admin` | ✅ |
```

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx next lint --file components/admin/WithdrawalQueueRow.tsx --file app/admin/withdrawals/page.tsx --file lib/admin/nav.ts --file app/admin/page.tsx`
Expected: clean.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites.

- [ ] **Step 8: Production build**

Run: `npm run build`
Expected: build succeeds; `/admin/withdrawals` appears in the route list.

- [ ] **Step 9: Commit**

```bash
git add components/admin/WithdrawalQueueRow.tsx "app/admin/withdrawals" lib/admin/nav.ts app/admin/page.tsx ROADMAP.md
git commit -m "$(cat <<'EOF'
feat: admin withdrawal queue (#9 sub-project 6 — v1.0 complete)

requireAdmin queue: resolve pending requests (paid/rejected + note) with
a last-20 resolved audit list. Withdrawals nav (admin-only), Overview
card link, and ROADMAP #9 marked done.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Shared `formatNaira` (`lib/format.ts`) + adoption in WithdrawalPanel/TournamentCard/RegistrationPanel/tournament-detail → Task 1. ✅
- `resolveWithdrawal` (`requireAdmin`; paid/rejected; reject-note required; pending-only guard; revalidate queue + dashboard) → Task 2. ✅
- `WithdrawalQueueRow` (note + paid/reject buttons via `name="action"`) → Task 3. ✅
- Page: pending (bank details, empty state) + last-20 resolved audit → Task 3. ✅
- Withdrawals nav (`adminOnly: true`) + Overview card link → Task 3. ✅
- ROADMAP #9 → ✅ (completes v1.0) → Task 3. ✅
- No migration → honored. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to"; every step has full code or exact string replacements. ✅

**Type consistency:** `formatNaira(n: number): string` (T1) used in T3 + the refactored sites. `WithdrawalResolveState`/`resolveWithdrawal` (T2) consumed by `WithdrawalQueueRow` (T3). `PendingWithdrawal` (T3 component) built by the page (T3). The `name="action"` values (`paid`/`rejected`) match the action's `action !== 'paid' && action !== 'rejected'` guard. Column names (`amount`, `bank_name`, `account_number`, `account_name`, `status`, `admin_note`, `resolved_at`, `requested_at`) verified against `lib/supabase/types.ts` (#8's `withdrawal_requests`). ✅

Note: the page uses the user's session client; RLS `wr_own_or_admin_read` returns all rows for an admin, so both queries see every request — and `requireAdmin` already gates the page.
