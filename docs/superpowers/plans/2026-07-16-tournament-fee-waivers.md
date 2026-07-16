# Tournament Fee Waivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin grant a named player free entry to one specific tournament; the player still fills the normal registration form but skips Paystack entirely.

**Architecture:** A new `tournament_fee_waivers` allowlist table (admin-managed) plus a `fee_waived` boolean on `tournament_registrations`. `registerForTournament` checks for a live (unredeemed) waiver before falling back to its existing Paystack flow, redeeming it with an atomic conditional UPDATE. No changes needed to capacity counting, bracket generation, or the registration-view state machine — all of them already key off `payment_status = 'paid'`, which a waived registration still sets.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS), zod, Vitest.

## Global Constraints

- `UNIQUE(tournament_id, player_id)` on `tournament_fee_waivers` — a player can only ever have one waiver row per tournament.
- Redemption MUST use a conditional UPDATE (`.eq('id', waiverId).is('redeemed_at', null)`) followed by checking the returned rows — never a separate check-then-update. This mirrors `debitWallet` in `lib/wallet/service.ts`.
- Granting/revoking a waiver is a financial action — gate both with `requireAdmin()` (not `requireStaff()`), matching `deleteTournament` in `lib/tournaments/admin-actions.ts`.
- A waiver only ever prevents a *future* charge — never refunds or reverses a payment that already happened.
- No changes to `registrationDetailsSchema` or the registration form fields — a waiver changes what happens after submission, not the data collected.
- This codebase's test convention: unit tests only for pure `lib/` functions (zod schemas, pure logic). Server Actions, pages, and components get no test files — verified via `tsc`, the existing Vitest suite, and `next build`.

---

### Task 1: Database migration — waivers table + `fee_waived` column

**Files:**
- Create: `supabase/migrations/031_tournament_fee_waivers.sql`

**Interfaces:**
- Produces: table `public.tournament_fee_waivers` (columns: `id`, `tournament_id`, `player_id`, `granted_by`, `reason`, `granted_at`, `redeemed_at`) and `public.tournament_registrations.fee_waived boolean NOT NULL DEFAULT false`, consumed by Tasks 2–5.

- [ ] **Step 1: Write the migration**

```sql
-- Tournament fee waivers — admin-granted free entry, one per (tournament, player).
-- Redeeming is an atomic conditional UPDATE (see lib/tournaments/actions.ts),
-- not a check-then-update, so redeemed_at can never be set twice.
CREATE TABLE public.tournament_fee_waivers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     uuid        NOT NULL REFERENCES public.profiles(id),
  granted_by    uuid        NOT NULL REFERENCES public.profiles(id),
  reason        text,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  redeemed_at   timestamptz,
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX ON public.tournament_fee_waivers (tournament_id);

ALTER TABLE public.tournament_fee_waivers ENABLE ROW LEVEL SECURITY;

-- Staff-only visibility — players never read this table directly; the
-- registration flow checks it server-side via the admin (service-role) client.
CREATE POLICY "waivers_staff_read" ON public.tournament_fee_waivers
  FOR SELECT USING (public.is_staff());
-- Granting/revoking waives real money — admin-only, not moderator.
CREATE POLICY "waivers_admin_insert" ON public.tournament_fee_waivers
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "waivers_admin_delete" ON public.tournament_fee_waivers
  FOR DELETE USING (public.is_admin());

-- Distinguishes a comped registration from a real Paystack payment for
-- financial reporting. payment_status stays 'paid' for both, so every
-- existing capacity/bracket/view-state check keeps working unchanged.
ALTER TABLE public.tournament_registrations
  ADD COLUMN fee_waived boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply the migration**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with `project_id` = the SentinelX project id, `name` = `tournament_fee_waivers`, `query` = the SQL above.

Expected: `{"success": true}`.

- [ ] **Step 3: Regenerate TypeScript types**

Use the `mcp__claude_ai_Supabase__generate_typescript_types` tool with the same `project_id`, then write the returned `types` string to `lib/supabase/types.ts` (full file replace — this file has no manual edits, it's always a full regen).

Expected: `tournament_fee_waivers` and `tournament_registrations.fee_waived` appear in the `Database['public']['Tables']` type.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors (the app doesn't reference the new table/column yet, so this just confirms the types file is syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_tournament_fee_waivers.sql lib/supabase/types.ts
git commit -m "feat: add tournament_fee_waivers table + fee_waived column"
```

---

### Task 2: Waiver grant-form validation schema

**Files:**
- Create: `lib/tournaments/waiver-schema.ts`
- Test: `lib/tournaments/waiver-schema.test.ts`

**Interfaces:**
- Produces: `waiverGrantSchema: ZodObject`, `type WaiverGrantInput = { username: string; reason: string }`, consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { waiverGrantSchema } from './waiver-schema'

describe('waiverGrantSchema', () => {
  it('accepts a username with no reason', () => {
    const r = waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: '' })
    expect(r.success).toBe(true)
  })

  it('accepts a username with a reason', () => {
    const r = waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: 'Season 1 champion' })
    expect(r.success).toBe(true)
  })

  it('requires a non-empty username', () => {
    expect(waiverGrantSchema.safeParse({ username: '  ', reason: '' }).success).toBe(false)
  })

  it('trims surrounding whitespace from username', () => {
    const r = waiverGrantSchema.safeParse({ username: '  DarkStrikerNG  ', reason: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.username).toBe('DarkStrikerNG')
  })

  it('rejects a reason over 200 characters', () => {
    expect(
      waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: 'x'.repeat(201) }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/waiver-schema.test.ts`
Expected: FAIL — `Cannot find module './waiver-schema'`

- [ ] **Step 3: Write the schema**

```typescript
import { z } from 'zod'

export const waiverGrantSchema = z.object({
  username: z.string().trim().min(1, 'Enter a username'),
  reason: z.union([z.literal(''), z.string().trim().max(200, 'Reason is too long')]),
})

export type WaiverGrantInput = z.infer<typeof waiverGrantSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/waiver-schema.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/waiver-schema.ts lib/tournaments/waiver-schema.test.ts
git commit -m "feat: add waiver grant-form validation schema"
```

---

### Task 3: Admin actions — grant and revoke a waiver

**Files:**
- Create: `lib/tournaments/waiver-admin-actions.ts`

**Interfaces:**
- Consumes: `waiverGrantSchema` (Task 2); `requireAdmin` from `@/lib/admin/auth`; `createClient` from `@/lib/supabase/server`.
- Produces: `grantWaiver(_prev, formData)`, `revokeWaiver(_prev, formData)`, both `(prev: WaiverFormState, formData: FormData) => Promise<WaiverFormState>` where `WaiverFormState = { error?: string; success?: boolean; warning?: string } | undefined` — consumed by Task 5's `WaiverForm`/`WaiverRow` via `useFormState`.

- [ ] **Step 1: Write the actions**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { waiverGrantSchema } from './waiver-schema'

export type WaiverFormState = { error?: string; success?: boolean; warning?: string } | undefined

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function grantWaiver(_prev: WaiverFormState, formData: FormData): Promise<WaiverFormState> {
  const ctx = await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = waiverGrantSchema.safeParse({
    username: formData.get('username') ?? '',
    reason: formData.get('reason') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()

  // Exact, case-insensitive match — usernames are unique, so this returns at
  // most one row. Not a fuzzy substring search (unlike the /players browse page).
  const { data: player } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', parsed.data.username)
    .maybeSingle()
  if (!player) return { error: `No player found with username "${parsed.data.username}".` }

  const { error } = await supabase.from('tournament_fee_waivers').insert({
    tournament_id: tournamentId,
    player_id: player.id,
    granted_by: ctx.userId,
    reason: parsed.data.reason || null,
  })
  if (error) {
    if (isUniqueViolation(error)) {
      return { error: 'This player already has a waiver for this tournament.' }
    }
    return { error: 'Could not grant the waiver. Please try again.' }
  }

  // Not a blocker — the waiver simply won't ever be redeemed for an already-paid
  // player, but the grant might still be worth recording (e.g. an award mention).
  const { count: alreadyPaidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', player.id)
    .eq('payment_status', 'paid')

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return {
    success: true,
    warning:
      (alreadyPaidCount ?? 0) > 0
        ? 'This player is already registered — the waiver was granted, but it won’t do anything since they already paid.'
        : undefined,
  }
}

export async function revokeWaiver(_prev: WaiverFormState, formData: FormData): Promise<WaiverFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!id) return { error: 'Missing waiver.' }

  const supabase = createClient()
  // Only an unredeemed waiver can be revoked — once redeemed_at is set, it's
  // a real completed registration, not a pending grant to cancel.
  const { error } = await supabase
    .from('tournament_fee_waivers')
    .delete()
    .eq('id', id)
    .is('redeemed_at', null)
  if (error) return { error: 'Could not revoke the waiver.' }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/waiver-admin-actions.ts
git commit -m "feat: add grantWaiver/revokeWaiver admin actions"
```

---

### Task 4: Redeem a waiver at registration time

**Files:**
- Modify: `lib/tournaments/actions.ts`

**Interfaces:**
- Consumes: `createAdminClient` (already imported); `tournament.slug` (already selected).
- Produces: `registerForTournament` now short-circuits Paystack when a live waiver exists for `(tournamentId, user.id)`.

- [ ] **Step 1: Insert the waiver check between the guard check and the Paystack call**

In `lib/tournaments/actions.ts`, the current flow after `regFields` is built:

```typescript
  const admin = createAdminClient()

  const reference = buildReference(tournamentId, user.id)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, ...regFields })
      .eq('id', existing.id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: tournament.registration_fee * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: user.id, slug: tournament.slug },
    })
  } catch (err) {
    console.error('[registerForTournament] Paystack initialize failed', {
      tournamentId,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
```

Replace it with:

```typescript
  const admin = createAdminClient()

  // A live (unredeemed) waiver skips Paystack entirely. Redeem it with a
  // conditional UPDATE — never check-then-update — so a raced double submit
  // can't redeem the same waiver twice.
  const { data: waiver } = await admin
    .from('tournament_fee_waivers')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .is('redeemed_at', null)
    .maybeSingle()

  if (waiver) {
    const { data: redeemed } = await admin
      .from('tournament_fee_waivers')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', waiver.id)
      .is('redeemed_at', null)
      .select('id')
    if (!redeemed || redeemed.length === 0) {
      return { error: 'This free-entry grant is no longer available. Please try again or contact an admin.' }
    }

    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: true,
      paystack_reference: null,
      ...regFields,
    }
    if (!existing) {
      const { error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow)
      if (insertErr) return { error: 'Could not complete registration. Please try again.' }
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: true, paystack_reference: null, ...regFields })
        .eq('id', existing.id)
    }

    redirect(`/tournaments/${tournament.slug}?paid=1`)
  }

  const reference = buildReference(tournamentId, user.id)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, ...regFields })
      .eq('id', existing.id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: tournament.registration_fee * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: user.id, slug: tournament.slug },
    })
  } catch (err) {
    console.error('[registerForTournament] Paystack initialize failed', {
      tournamentId,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
```

Note: `redirect()` throws internally (Next.js control flow), so the early `redirect(...)` inside the `if (waiver)` block cleanly exits the function — the Paystack code below it never runs for a waived registration.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/actions.ts
git commit -m "feat: redeem a live fee waiver instead of charging Paystack"
```

---

### Task 5: Admin UI — grant/revoke waivers on the registrations page

**Files:**
- Create: `components/admin/WaiverForm.tsx`
- Create: `components/admin/WaiverRow.tsx`
- Modify: `app/admin/tournaments/[id]/registrations/page.tsx`

**Interfaces:**
- Consumes: `grantWaiver`, `revokeWaiver`, `WaiverFormState` (Task 3).
- Produces: `WaiverForm({ tournamentId })`, `WaiverRow({ waiver, tournamentId })` where `waiver: { id: string; username: string | null; reason: string | null; grantedAt: string; redeemedAt: string | null }`.

- [ ] **Step 1: Write `WaiverForm`**

```typescript
'use client'
import { useFormState } from 'react-dom'
import { grantWaiver, type WaiverFormState } from '@/lib/tournaments/waiver-admin-actions'

export function WaiverForm({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<WaiverFormState, FormData>(grantWaiver, undefined)

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <h3 className="text-sm font-bold text-white">Grant free entry</h3>
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-xs font-medium text-slate-400">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          placeholder="e.g. DarkStrikerNG"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-xs font-medium text-slate-400">Reason (optional)</label>
        <input
          id="reason"
          name="reason"
          type="text"
          placeholder="e.g. Season 1 champion award"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
        >
          Grant waiver
        </button>
        {state?.success && !state.warning && <span className="text-xs text-emerald-400">Waiver granted.</span>}
        {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
      {state?.warning && <p className="text-xs text-amber-400">{state.warning}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Write `WaiverRow`**

```typescript
'use client'
import { useFormState } from 'react-dom'
import { revokeWaiver, type WaiverFormState } from '@/lib/tournaments/waiver-admin-actions'
import { formatDateTime } from '@/lib/format'

export interface AdminWaiver {
  id: string
  username: string | null
  reason: string | null
  grantedAt: string
  redeemedAt: string | null
}

export function WaiverRow({
  waiver,
  tournamentId,
  canRevoke,
}: {
  waiver: AdminWaiver
  tournamentId: string
  canRevoke: boolean
}) {
  const [state, action] = useFormState<WaiverFormState, FormData>(revokeWaiver, undefined)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {waiver.username ?? 'Unknown player'}
          {waiver.redeemedAt ? (
            <span className="ml-2 text-[11px] font-semibold text-emerald-400">
              Redeemed {formatDateTime(waiver.redeemedAt)}
            </span>
          ) : (
            <span className="ml-2 text-[11px] font-semibold text-amber-400">Not yet used</span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {waiver.reason ?? 'No reason given'} · Granted {formatDateTime(waiver.grantedAt)}
        </p>
      </div>
      {!waiver.redeemedAt && canRevoke && (
        <form action={action}>
          <input type="hidden" name="id" value={waiver.id} />
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <button
            type="submit"
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
          >
            Revoke
          </button>
        </form>
      )}
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
```

Note: `canRevoke` gates the Revoke button on the client per the spec ("moderators included" can view the list, but only admin can revoke). RLS (`waivers_admin_delete`) is the real enforcement boundary — this prop is a UI-only convenience so moderators don't see a button that would fail.

- [ ] **Step 3: Wire both into the registrations page**

In `app/admin/tournaments/[id]/registrations/page.tsx`, add the waiver query and render the new section. Full updated file:

```typescript
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationsTable, type AdminRegistrationRow } from '@/components/admin/RegistrationsTable'
import { WaiverForm } from '@/components/admin/WaiverForm'
import { WaiverRow, type AdminWaiver } from '@/components/admin/WaiverRow'

export const metadata: Metadata = { title: 'Registrations · Admin · SentinelX' }

type ProfileRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: ProfileRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}

export default async function AdminRegistrationsPage({ params }: { params: { id: string } }) {
  const ctx = await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const [{ data }, { data: waiverRows }] = await Promise.all([
    supabase
      .from('tournament_registrations')
      .select(
        'id, payment_status, registered_at, reg_display_name, reg_whatsapp, reg_club_name, reg_ign_tag, profiles(username)',
      )
      .eq('tournament_id', t.id)
      .order('registered_at', { ascending: false }),
    supabase
      .from('tournament_fee_waivers')
      .select('id, reason, granted_at, redeemed_at, profiles!tournament_fee_waivers_player_id_fkey(username)')
      .eq('tournament_id', t.id)
      .order('granted_at', { ascending: false }),
  ])

  const rows: AdminRegistrationRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      payment_status: string
      registered_at: string
      reg_display_name: string | null
      reg_whatsapp: string | null
      reg_club_name: string | null
      reg_ign_tag: string | null
      profiles: ProfileRef
    }
    return {
      id: r.id,
      username: firstUsername(r.profiles),
      regDisplayName: r.reg_display_name,
      regWhatsapp: r.reg_whatsapp,
      regClubName: r.reg_club_name,
      regIgnTag: r.reg_ign_tag,
      paymentStatus: r.payment_status,
      registeredAt: r.registered_at,
    }
  })

  const waivers: AdminWaiver[] = ((waiverRows as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      reason: string | null
      granted_at: string
      redeemed_at: string | null
      profiles: ProfileRef
    }
    return {
      id: w.id,
      username: firstUsername(w.profiles),
      reason: w.reason,
      grantedAt: w.granted_at,
      redeemedAt: w.redeemed_at,
    }
  })

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Registrations</h2>

      {(ctx.isAdmin || waivers.length > 0) && (
        <div className="mb-6 space-y-3">
          {ctx.isAdmin && <WaiverForm tournamentId={t.id} />}
          {waivers.length > 0 && (
            <div className="space-y-2">
              {waivers.map((w) => (
                <WaiverRow key={w.id} waiver={w} tournamentId={t.id} canRevoke={ctx.isAdmin} />
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No registrations yet.
        </p>
      ) : (
        <RegistrationsTable rows={rows} />
      )}
    </section>
  )
}
```

Note: `profiles!tournament_fee_waivers_player_id_fkey(username)` disambiguates the join — `tournament_fee_waivers` has two FKs to `profiles` (`player_id` and `granted_by`), so PostgREST needs the explicit constraint name to know which relationship to follow. This matches the FK naming convention Postgres auto-generates (`<table>_<column>_fkey`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (including the new `waiver-schema.test.ts`).

Run: `npx next build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/admin/WaiverForm.tsx components/admin/WaiverRow.tsx "app/admin/tournaments/[id]/registrations/page.tsx"
git commit -m "feat: add grant/revoke free-entry waiver UI to admin registrations page"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Grant a waiver**

As admin, visit `/admin/tournaments/{DLS 26 Season 2 id}/registrations`, grant a waiver to a real test-adjacent username with a reason, confirm it appears in the "Granted waivers" list as "Not yet used".

- [ ] **Step 2: Redeem it**

Log in as that player, visit the tournament page, fill the registration form, submit. Confirm: no Paystack redirect happens; the tournament page reloads at `?paid=1` showing "✓ You're registered". Re-check the admin registrations page: the waiver now shows "Redeemed {time}", and the registrations table shows this player with payment status `paid`.

- [ ] **Step 3: Confirm revoke works**

Grant a second waiver to a different username, then click "Revoke" before it's used. Confirm it disappears from the list and re-granting the same username afterward succeeds (no stale unique-constraint conflict).

- [ ] **Step 4: Push**

```bash
git push origin main
```
