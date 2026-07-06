# Tournament Detail + Paystack Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public tournament detail page (`/tournaments/[slug]`) and a paid registration flow (₦500 via Paystack hosted checkout), with reliable payment confirmation via a redirect callback and an independent webhook.

**Architecture:** A Server Component renders the tournament and a stateful registration panel. Registration is a Server Action that creates a `pending` registration row and redirects to Paystack. Two routes — a GET callback (user redirect) and a POST webhook (machine-to-machine) — both call one idempotent `confirmRegistration(reference)` that verifies the transaction with Paystack (using the service-role client) and flips the row to `paid`. Pure decision logic is extracted into testable functions; IO wrappers and UI are verified by build + manual testing on the deployed URL.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (`@supabase/ssr` + `@supabase/supabase-js` service-role), Paystack REST API, vitest.

## Global Constraints

- Mobile-first, design for 375px and scale up (Tailwind).
- Server Components by default; `"use client"` only where interactivity is needed.
- All Paystack verification is server-side only. `PAYSTACK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are never imported by client code.
- Registration fee is **₦500** → send **50000 kobo** to Paystack. Use `REGISTRATION_FEE_NGN` from `lib/paystack/index.ts` (value `500`); kobo = `REGISTRATION_FEE_NGN * 100`.
- `payment_status` transitions (`pending` → `paid`) happen only via the service-role client (RLS `tr_staff_update` blocks anon/user clients).
- Tests are colocated `*.test.ts`, vitest node env, `describe/it/expect`, pure-function style (no mocking framework). Run with `npm test`.
- A `'use server'` module may export **only** async functions — pure helpers live in separate files.
- Existing DB constraints (no migration): `UNIQUE (tournament_id, player_id)`, `paystack_reference UNIQUE`.
- `NEXT_PUBLIC_SITE_URL` is the canonical origin for building the Paystack `callback_url`.

---

## File Structure

- Create `lib/paystack/server.ts` — Paystack API calls + signature verify + reference builder (server-only).
- Create `lib/supabase/admin.ts` — service-role Supabase client (server-only).
- Create `lib/tournaments/confirm.ts` — `confirmRegistration` + pure `decideConfirmation`.
- Create `lib/tournaments/guard.ts` — pure `checkCanRegister`.
- Create `lib/tournaments/actions.ts` — `registerForTournament` Server Action.
- Create `lib/tournaments/view.ts` — pure `resolveRegistrationView`.
- Create `app/api/paystack/callback/route.ts` — GET callback (user redirect).
- Create `app/api/paystack/webhook/route.ts` — POST webhook.
- Create `app/(public)/tournaments/[slug]/page.tsx` — detail page.
- Create `components/tournament/RegistrationPanel.tsx` — client registration panel (7 states).
- Tests: `lib/paystack/server.test.ts`, `lib/tournaments/confirm.test.ts`, `lib/tournaments/guard.test.ts`, `lib/tournaments/view.test.ts`.

---

## Task 1: Paystack server module

**Files:**
- Create: `lib/paystack/server.ts`
- Test: `lib/paystack/server.test.ts`

**Interfaces:**
- Consumes: `PAYSTACK_BASE_URL`, `REGISTRATION_FEE_NGN` from `lib/paystack/index.ts`.
- Produces:
  - `buildReference(tournamentId: string, userId: string): string`
  - `verifyWebhookSignature(rawBody: string, signature: string | null): boolean`
  - `initializeTransaction(params: InitializeParams): Promise<string>` (returns `authorization_url`)
  - `verifyTransaction(reference: string): Promise<VerifyResult>` where `VerifyResult = { status: string; amountKobo: number; reference: string }`
  - `InitializeParams = { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata?: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Create `lib/paystack/server.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'crypto'
import { buildReference, verifyWebhookSignature } from './server'

beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
})

describe('buildReference', () => {
  it('is prefixed and encodes truncated tournament + user ids', () => {
    const ref = buildReference(
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(ref).toMatch(/^sx_11111111_aaaaaaaa_[a-z0-9]{8}$/)
  })

  it('produces distinct references on repeat calls', () => {
    expect(buildReference('t', 'u')).not.toBe(buildReference('t', 'u'))
  })
})

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'charge.success' })
  const sign = (b: string) => createHmac('sha512', 'sk_test_dummy').update(b).digest('hex')

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(body + 'x', sign(body))).toBe(false)
  })

  it('rejects a null signature', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/paystack/server.test.ts`
Expected: FAIL — cannot resolve `./server`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/paystack/server.ts`:

```ts
// Server-only. Never import from client components — reads PAYSTACK_SECRET_KEY.
import { createHmac, timingSafeEqual } from 'crypto'
import { PAYSTACK_BASE_URL } from './index'

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return key
}

export function buildReference(tournamentId: string, userId: string): string {
  const t = tournamentId.replace(/-/g, '').slice(0, 8)
  const u = userId.replace(/-/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sx_${t}_${u}_${rand}`
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = createHmac('sha512', secret()).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface InitializeParams {
  email: string
  amountKobo: number
  reference: string
  callbackUrl: string
  metadata?: Record<string, unknown>
}

export async function initializeTransaction(params: InitializeParams): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata ?? {},
    }),
  })
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack initialize failed')
  }
  return json.data.authorization_url as string
}

export interface VerifyResult {
  status: string
  amountKobo: number
  reference: string
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack verify failed')
  }
  return {
    status: json.data.status,
    amountKobo: json.data.amount,
    reference: json.data.reference,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/paystack/server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/paystack/server.ts lib/paystack/server.test.ts
git commit -m "feat: Paystack server module (initialize, verify, signature, reference)"
```

---

## Task 2: Confirmation core + service-role client

**Files:**
- Create: `lib/supabase/admin.ts`
- Create: `lib/tournaments/confirm.ts`
- Test: `lib/tournaments/confirm.test.ts`

**Interfaces:**
- Consumes: `REGISTRATION_FEE_NGN` from `lib/paystack/index.ts`; `verifyTransaction` from `lib/paystack/server.ts`; `Database` type from `lib/supabase/types.ts`.
- Produces:
  - `createAdminClient()` — service-role Supabase client.
  - `type ConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'`
  - `decideConfirmation(args: { existing: { payment_status: string } | null; verify: { status: string; amountKobo: number } | null }): ConfirmResult`
  - `confirmRegistration(reference: string): Promise<ConfirmResult>`

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/confirm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decideConfirmation } from './confirm'

const pending = { payment_status: 'pending' }
const paid = { payment_status: 'paid' }
const ok = { status: 'success', amountKobo: 50000 }

describe('decideConfirmation', () => {
  it('returns not_found when there is no registration', () => {
    expect(decideConfirmation({ existing: null, verify: ok })).toBe('not_found')
  })

  it('returns already_paid before verifying (idempotent short-circuit)', () => {
    expect(decideConfirmation({ existing: paid, verify: ok })).toBe('already_paid')
  })

  it('confirms on success with the exact expected amount', () => {
    expect(decideConfirmation({ existing: pending, verify: ok })).toBe('confirmed')
  })

  it('rejects when Paystack status is not success', () => {
    expect(
      decideConfirmation({ existing: pending, verify: { status: 'failed', amountKobo: 50000 } }),
    ).toBe('not_successful')
  })

  it('rejects on amount mismatch (partial or tampered payment)', () => {
    expect(
      decideConfirmation({ existing: pending, verify: { status: 'success', amountKobo: 100 } }),
    ).toBe('not_successful')
  })

  it('rejects when verify data is unavailable', () => {
    expect(decideConfirmation({ existing: pending, verify: null })).toBe('not_successful')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tournaments/confirm.test.ts`
Expected: FAIL — cannot resolve `./confirm`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/supabase/admin.ts`:

```ts
// Service-role client — bypasses RLS. SERVER-ONLY. Never import from client code.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```

Create `lib/tournaments/confirm.ts`:

```ts
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type ConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

const EXPECTED_KOBO = REGISTRATION_FEE_NGN * 100

// Pure decision: given the current row status and Paystack's verify result,
// decide the outcome. No IO — unit tested directly.
export function decideConfirmation(args: {
  existing: { payment_status: string } | null
  verify: { status: string; amountKobo: number } | null
}): ConfirmResult {
  if (!args.existing) return 'not_found'
  if (args.existing.payment_status === 'paid') return 'already_paid'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo !== EXPECTED_KOBO) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook.
export async function confirmRegistration(reference: string): Promise<ConfirmResult> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.payment_status === 'paid') return 'already_paid'

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch {
    verify = null
  }

  const decision = decideConfirmation({ existing, verify })
  if (decision !== 'confirmed') return decision

  // Guard against races: only the pending → paid transition writes.
  await db
    .from('tournament_registrations')
    .update({ payment_status: 'paid' })
    .eq('id', existing.id)
    .eq('payment_status', 'pending')

  return 'confirmed'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tournaments/confirm.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/supabase/admin.ts lib/tournaments/confirm.ts lib/tournaments/confirm.test.ts
git commit -m "feat: idempotent confirmRegistration + service-role client"
```

---

## Task 3: Registration Server Action + capacity guard

**Files:**
- Create: `lib/tournaments/guard.ts`
- Create: `lib/tournaments/actions.ts`
- Test: `lib/tournaments/guard.test.ts`

**Interfaces:**
- Consumes: `checkCanRegister` (this task); `initializeTransaction`, `buildReference` from `lib/paystack/server.ts`; `REGISTRATION_FEE_NGN` from `lib/paystack`; `createClient` from `lib/supabase/server.ts`.
- Produces:
  - `type RegisterGuard = { ok: true } | { ok: false; reason: 'not_open' | 'full' | 'already_registered' }`
  - `checkCanRegister(args: { status: string; paidCount: number; maxPlayers: number | null; existingStatus: string | null }): RegisterGuard`
  - `type RegisterState = { error?: string } | undefined`
  - `registerForTournament(_prev: RegisterState, formData: FormData): Promise<RegisterState>` (redirects on success; `formData` carries `tournamentId`)

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkCanRegister } from './guard'

describe('checkCanRegister', () => {
  it('allows an open tournament with capacity and no prior registration', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: true })
  })

  it('allows a pending registration to proceed (reuse reference)', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: 'pending' }),
    ).toEqual({ ok: true })
  })

  it('blocks a player who already paid', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: 'paid' }),
    ).toEqual({ ok: false, reason: 'already_registered' })
  })

  it('blocks when registration is not open', () => {
    expect(
      checkCanRegister({ status: 'registration_closed', paidCount: 3, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: false, reason: 'not_open' })
  })

  it('blocks when the tournament is full', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 16, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: false, reason: 'full' })
  })

  it('treats null max_players as uncapped', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 999, maxPlayers: null, existingStatus: null }),
    ).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tournaments/guard.test.ts`
Expected: FAIL — cannot resolve `./guard`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/guard.ts`:

```ts
export type RegisterGuard =
  | { ok: true }
  | { ok: false; reason: 'not_open' | 'full' | 'already_registered' }

// Precedence: a paid player is "already_registered" regardless of status;
// then status must be open; then capacity. A 'pending' row is allowed through
// so the player can retry payment.
export function checkCanRegister(args: {
  status: string
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
}): RegisterGuard {
  if (args.existingStatus === 'paid') return { ok: false, reason: 'already_registered' }
  if (args.status !== 'registration_open') return { ok: false, reason: 'not_open' }
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) {
    return { ok: false, reason: 'full' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tournaments/guard.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the Server Action**

Create `lib/tournaments/actions.ts`:

```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { checkCanRegister } from './guard'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type RegisterState = { error?: string } | undefined

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  // Re-fetch server-side; never trust the client for status or capacity.
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status, paystack_reference')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .maybeSingle()

  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
  })
  if (!guard.ok) {
    return {
      error:
        guard.reason === 'already_registered'
          ? "You're already registered for this tournament."
          : guard.reason === 'full'
            ? 'This tournament is full.'
            : 'Registration is closed for this tournament.',
    }
  }

  // Reuse the pending row's reference; otherwise create a fresh pending row.
  let reference = existing?.paystack_reference ?? null
  if (!existing) {
    reference = buildReference(tournamentId, user.id)
    const { error: insertErr } = await supabase.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else if (!reference) {
    reference = buildReference(tournamentId, user.id)
    await supabase
      .from('tournament_registrations')
      .update({ paystack_reference: reference })
      .eq('id', existing.id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: REGISTRATION_FEE_NGN * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: user.id, slug: tournament.slug },
    })
  } catch {
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
```

- [ ] **Step 6: Typecheck & commit**

Run: `npx tsc --noEmit` → clean. Run: `npm test` → all pass.

```bash
git add lib/tournaments/guard.ts lib/tournaments/guard.test.ts lib/tournaments/actions.ts
git commit -m "feat: registerForTournament action + capacity/status guard"
```

---

## Task 4: Paystack callback + webhook routes

**Files:**
- Create: `app/api/paystack/callback/route.ts`
- Create: `app/api/paystack/webhook/route.ts`

**Interfaces:**
- Consumes: `confirmRegistration` from `lib/tournaments/confirm.ts`; `createAdminClient` from `lib/supabase/admin.ts`; `verifyWebhookSignature` from `lib/paystack/server.ts`.
- Produces: HTTP routes only (no exported functions used by other tasks).

- [ ] **Step 1: Write the callback route**

Create `app/api/paystack/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Paystack redirects the *user's browser* here with ?reference= after checkout.
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('reference')
  const origin = req.nextUrl.origin
  if (!reference) {
    return NextResponse.redirect(new URL('/tournaments', origin))
  }

  const result = await confirmRegistration(reference)

  // Resolve the slug so we can land the user back on the tournament page.
  const db = createAdminClient()
  const { data } = await db
    .from('tournament_registrations')
    .select('tournaments(slug)')
    .eq('paystack_reference', reference)
    .maybeSingle()
  const slug = (data?.tournaments as { slug: string } | null)?.slug

  const success = result === 'confirmed' || result === 'already_paid'
  const dest = slug
    ? `/tournaments/${slug}?${success ? 'paid=1' : 'payment=failed'}`
    : '/tournaments'
  return NextResponse.redirect(new URL(dest, origin))
}
```

- [ ] **Step 2: Write the webhook route**

Create `app/api/paystack/webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'

export const runtime = 'nodejs'

// Machine-to-machine. Fires independently of the user's browser — the reliable
// source of truth for payment status.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let event: { event?: string; data?: { reference?: string } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  if (event.event === 'charge.success' && event.data?.reference) {
    await confirmRegistration(event.data.reference)
  }

  // Always 200 on a well-formed, signed request; Paystack retries non-2xx.
  return new NextResponse('ok', { status: 200 })
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → both routes appear under `Route (app)` as `ƒ /api/paystack/callback` and `ƒ /api/paystack/webhook`.

- [ ] **Step 4: Commit**

```bash
git add app/api/paystack/callback/route.ts app/api/paystack/webhook/route.ts
git commit -m "feat: Paystack callback + webhook routes"
```

- [ ] **Step 5: Manual test note (deferred until page exists + deployed)**

After Task 5 is deployed with Paystack **test** keys:
- Register → pay with a Paystack test card → confirm redirect lands on `/tournaments/<slug>?paid=1` and the row is `paid`.
- In the Paystack dashboard, set the webhook URL to `${SITE_URL}/api/paystack/webhook`; trigger/resend a `charge.success` and confirm the row flips even without the browser redirect.
- Send an unsigned POST to the webhook → expect `401`.

---

## Task 5: Detail page + registration panel

**Files:**
- Create: `lib/tournaments/view.ts`
- Create: `components/tournament/RegistrationPanel.tsx`
- Create: `app/(public)/tournaments/[slug]/page.tsx`
- Test: `lib/tournaments/view.test.ts`

**Interfaces:**
- Consumes: `resolveRegistrationView` (this task); `registerForTournament`, `RegisterState` from `lib/tournaments/actions.ts`; `createClient` from `lib/supabase/server.ts`; `REGISTRATION_FEE_NGN` from `lib/paystack`.
- Produces:
  - `type RegView = 'guest' | 'can_register' | 'complete_payment' | 'registered' | 'full' | 'closed' | 'ended'`
  - `resolveRegistrationView(args: { status: string; loggedIn: boolean; paidCount: number; maxPlayers: number | null; existingStatus: string | null }): RegView`
  - `RegistrationPanel` React component.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveRegistrationView } from './view'

const base = { status: 'registration_open', loggedIn: true, paidCount: 0, maxPlayers: 16, existingStatus: null as string | null }

describe('resolveRegistrationView', () => {
  it('guest: open tournament, not logged in', () => {
    expect(resolveRegistrationView({ ...base, loggedIn: false })).toBe('guest')
  })

  it('can_register: open, logged in, capacity, no registration', () => {
    expect(resolveRegistrationView(base)).toBe('can_register')
  })

  it('complete_payment: has a pending registration', () => {
    expect(resolveRegistrationView({ ...base, existingStatus: 'pending' })).toBe('complete_payment')
  })

  it('registered: has a paid registration (highest precedence)', () => {
    expect(resolveRegistrationView({ ...base, status: 'completed', existingStatus: 'paid' })).toBe('registered')
  })

  it('full: open but paidCount at capacity', () => {
    expect(resolveRegistrationView({ ...base, paidCount: 16 })).toBe('full')
  })

  it('closed: registration_closed or active', () => {
    expect(resolveRegistrationView({ ...base, status: 'registration_closed' })).toBe('closed')
    expect(resolveRegistrationView({ ...base, status: 'active' })).toBe('closed')
  })

  it('ended: completed tournament with no registration', () => {
    expect(resolveRegistrationView({ ...base, status: 'completed' })).toBe('ended')
  })

  it('closed takes precedence over guest for a not-open tournament', () => {
    expect(resolveRegistrationView({ ...base, status: 'active', loggedIn: false })).toBe('closed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tournaments/view.test.ts`
Expected: FAIL — cannot resolve `./view`.

- [ ] **Step 3: Write the pure resolver**

Create `lib/tournaments/view.ts`:

```ts
export type RegView =
  | 'guest'
  | 'can_register'
  | 'complete_payment'
  | 'registered'
  | 'full'
  | 'closed'
  | 'ended'

// Precedence: a paid player always sees "registered". Otherwise the tournament
// lifecycle (ended / closed) wins over the open-registration sub-states.
export function resolveRegistrationView(args: {
  status: string
  loggedIn: boolean
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
}): RegView {
  if (args.existingStatus === 'paid') return 'registered'
  if (args.status === 'completed') return 'ended'
  if (args.status === 'registration_closed' || args.status === 'active') return 'closed'
  // status is 'registration_open' (draft pages 404 before reaching here).
  if (!args.loggedIn) return 'guest'
  if (args.existingStatus === 'pending') return 'complete_payment'
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) return 'full'
  return 'can_register'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tournaments/view.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the registration panel (client)**

Create `components/tournament/RegistrationPanel.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { registerForTournament, type RegisterState } from '@/lib/tournaments/actions'
import type { RegView } from '@/lib/tournaments/view'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

const box = 'rounded-2xl border border-slate-800 bg-slate-900 p-5'

export function RegistrationPanel({
  view,
  tournamentId,
  slug,
  fee,
  loginHref,
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
}) {
  const bracketHref = `/tournaments/${slug}/bracket`

  if (view === 'guest') {
    return (
      <div className={box}>
        <Link
          href={loginHref}
          className="block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          Register — ₦{fee.toLocaleString()}
        </Link>
        <p className="mt-2 text-center text-xs text-slate-500">Log in to register and pay.</p>
      </div>
    )
  }

  if (view === 'can_register' || view === 'complete_payment') {
    return (
      <div className={box}>
        <RegisterForm
          tournamentId={tournamentId}
          label={
            view === 'complete_payment' ? 'Complete payment →' : `Register — ₦${fee.toLocaleString()}`
          }
        />
        <p className="mt-2 text-center text-xs text-slate-500">
          Secure payment via Paystack. Entry fee ₦{fee.toLocaleString()}.
        </p>
      </div>
    )
  }

  if (view === 'registered') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-emerald-400">✓ You're registered</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link href="/dashboard" className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500">
            My Dashboard
          </Link>
          <Link href={bracketHref} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500">
            View Bracket
          </Link>
        </div>
      </div>
    )
  }

  const message =
    view === 'full' ? 'This tournament is full.'
    : view === 'ended' ? 'This tournament has ended.'
    : 'Registration is closed.'

  return (
    <div className={box}>
      <p className="text-center text-sm font-semibold text-slate-400">{message}</p>
      {view !== 'full' && (
        <Link href={bracketHref} className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500">
          View Bracket
        </Link>
      )}
    </div>
  )
}

function RegisterForm({ tournamentId, label }: { tournamentId: string; label: string }) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
  return (
    <form action={formAction}>
      <input type="hidden" name="tournamentId" value={tournamentId} />
      {state?.error && <p className="mb-2 text-center text-sm text-red-400">{state.error}</p>}
      <SubmitButton label={label} pendingLabel="Redirecting to payment…" />
    </form>
  )
}
```

- [ ] **Step 6: Write the detail page**

Create `app/(public)/tournaments/[slug]/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { resolveRegistrationView } from '@/lib/tournaments/view'
import { RegistrationPanel } from '@/components/tournament/RegistrationPanel'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

const STATUS: Record<string, { label: string; cls: string }> = {
  active:              { label: 'LIVE',        cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  registration_open:   { label: 'OPEN',        cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  registration_closed: { label: 'REG. CLOSED', cls: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  completed:           { label: 'ENDED',       cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, description, banner_url, prize_pool, registration_fee, status, format, max_players, registration_end, tournament_start, games(name, icon_url, slug)')
    .eq('slug', slug)
    .maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t || t.status === 'draft') return { title: 'Tournament — Sentinel X' }
  const title = `${t.title} — Sentinel X`
  const description =
    t.description?.slice(0, 160) ??
    `₦${t.prize_pool.toLocaleString()} prize pool. Entry ₦${t.registration_fee.toLocaleString()}. Compete on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/tournaments/${t.slug}`,
      siteName: 'Sentinel X',
      type: 'website',
      images: t.banner_url ? [t.banner_url] : undefined,
    },
  }
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { paid?: string; payment?: string }
}) {
  const supabase = createClient()
  const t = await getTournament(params.slug)
  if (!t || t.status === 'draft') notFound()

  const [{ count: paidCount }, { data: { user } }] = await Promise.all([
    supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id)
      .eq('payment_status', 'paid'),
    supabase.auth.getUser(),
  ])

  let existingStatus: string | null = null
  if (user) {
    const { data: reg } = await supabase
      .from('tournament_registrations')
      .select('payment_status')
      .eq('tournament_id', t.id)
      .eq('player_id', user.id)
      .maybeSingle()
    existingStatus = reg?.payment_status ?? null
  }

  const view = resolveRegistrationView({
    status: t.status,
    loggedIn: !!user,
    paidCount: paidCount ?? 0,
    maxPlayers: t.max_players,
    existingStatus,
  })

  const status = STATUS[t.status] ?? STATUS.completed
  const start = fmtDate(t.tournament_start)
  const regEnd = fmtDate(t.registration_end)
  const game = t.games as { name: string; icon_url: string | null; slug: string } | null
  const shareText = `${t.title} on Sentinel X — ₦${t.prize_pool.toLocaleString()} prize pool 🎮 ${SITE_URL}/tournaments/${t.slug}`

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link href="/tournaments" className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300">
        ← All tournaments
      </Link>

      {searchParams.paid === '1' && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-400">
          🎉 Payment confirmed — you're registered!
        </div>
      )}
      {searchParams.payment === 'failed' && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
          Payment was not completed. You can try again below.
        </div>
      )}

      {t.banner_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.banner_url} alt={t.title} className="mb-5 aspect-video w-full rounded-2xl border border-slate-800 object-cover" />
      )}

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {game?.name ?? 'Mobile Esports'}
          </p>
          <h1 className="text-2xl font-black leading-tight text-white">{t.title}</h1>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:grid-cols-4">
        <Stat label="Prize Pool" value={`₦${t.prize_pool.toLocaleString()}`} accent />
        <Stat label="Entry Fee" value={`₦${t.registration_fee.toLocaleString()}`} />
        <Stat label="Players" value={t.max_players != null ? `${paidCount ?? 0}/${t.max_players}` : `${paidCount ?? 0}`} />
        <Stat label="Format" value={t.format === 'group_knockout' ? 'Groups + KO' : t.format} />
      </div>

      <div className="mb-6">
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          loginHref={`/login?next=/tournaments/${t.slug}`}
        />
      </div>

      {(start || regEnd) && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-400">
          {start && <span>🗓️ Starts {start}</span>}
          {regEnd && t.status === 'registration_open' && (
            <span className="text-violet-400/80">⏳ Registration closes {regEnd}</span>
          )}
        </div>
      )}

      {t.description && (
        <div className="mb-8">
          <h2 className="mb-2 text-base font-bold text-white">About</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{t.description}</p>
        </div>
      )}

      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        Share on WhatsApp
      </a>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`font-black ${accent ? 'text-lg text-violet-400' : 'text-lg text-white'}`}>{value}</p>
    </div>
  )
}
```

- [ ] **Step 7: Verify build, lint, tests**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → no warnings/errors.
Run: `npm test` → all suites pass.
Run: `npm run build` → `/tournaments/[slug]` compiles as a dynamic route.

- [ ] **Step 8: Commit**

```bash
git add lib/tournaments/view.ts lib/tournaments/view.test.ts components/tournament/RegistrationPanel.tsx "app/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat: tournament detail page + registration panel (7 states)"
```

---

## Task 6: Roadmap update + full verification

**Files:**
- Modify: `ROADMAP.md` (mark #3 ✅)

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build` → all green.

- [ ] **Step 2: Mark the task done**

In `ROADMAP.md`, change the row:
`| 3 | Tournament detail + Paystack registration (₦500) | \`/tournaments/[slug]\` | ⬜ |`
to `… | ✅ |`.

- [ ] **Step 3: Commit & push**

```bash
git add ROADMAP.md
git commit -m "chore: mark v1.0 #3 (tournament detail + registration) done"
git push origin main
```

- [ ] **Step 4: Post-deploy manual verification (Paystack test mode)**

On the deployed Vercel URL:
- Log in, open an open tournament, click **Register — ₦500**, pay with a Paystack test card → redirected to `?paid=1`, panel shows "✓ You're registered", players count incremented.
- Set the Paystack dashboard webhook to `${SITE_URL}/api/paystack/webhook`; resend a `charge.success` and confirm idempotency (row stays a single `paid`).
- Confirm the seven CTA states by viewing tournaments in each status and as guest/logged-in.

---

## Self-Review

**Spec coverage:**
- Detail page + metadata + share → Task 5. ✅
- Seven CTA states → `resolveRegistrationView` + `RegistrationPanel` (Task 5). ✅
- Paystack module (initialize/verify/signature/reference) → Task 1. ✅
- Registration action with server-side re-check → Task 3. ✅
- Idempotent `confirmRegistration` + service-role client → Task 2. ✅
- Callback + webhook routes → Task 4. ✅
- Error handling (initialize fail, amount mismatch, bad signature, double confirm) → covered across Tasks 1–4 and tested in `confirm.test.ts` / `server.test.ts`. ✅
- Testing plan (signature, reference, confirmation branches) → Tasks 1, 2, plus guard/view. ✅
- No migration needed (constraints verified) → stated in Global Constraints. ✅

**Placeholder scan:** No TBD/TODO; every code step is complete. ✅

**Type consistency:** `ConfirmResult`, `RegisterGuard`, `RegView`, `RegisterState`, `InitializeParams`, `VerifyResult` are defined once and consumed with matching names/shapes. `registerForTournament(_prev, formData)` matches the `useFormState` call in `RegistrationPanel`. `REGISTRATION_FEE_NGN * 100` used consistently for kobo. ✅
