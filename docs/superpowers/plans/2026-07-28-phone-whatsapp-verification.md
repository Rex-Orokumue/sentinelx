# Phone/WhatsApp Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can verify a phone number over WhatsApp — a 6-digit code sent via Meta's free-tier Cloud API, confirmed against a short-lived hashed code — required at `/onboarding/phone` for any account created after this ships, and available voluntarily from the dashboard profile form for every pre-existing (grandfathered) account.

**Architecture:** A new ephemeral `phone_verifications` table (one pending code per user, service-role-write-only) backs two Server Actions, `requestPhoneCode`/`confirmPhoneCode` (`lib/phone/actions.ts`), which call a Termii-pattern no-op-if-unconfigured sender (`lib/notifications/whatsapp-cloud-api.ts`) and write the verified number to `profiles.phone`/`phone_verified_at` on success. `resolveOnboardingGate()` (from the Google sign-in plan) is extended with a second branch so the existing `/dashboard` middleware gate also catches an unverified new signup. A shared `PhoneVerifyForm` component is reused by both the onboarding page and the dashboard profile form.

**Tech Stack:** Next.js 14 App Router (Server Actions), Supabase (Postgres + RLS), Meta WhatsApp Cloud API, Vitest, TypeScript, Tailwind.

## Global Constraints

- **Depends on** `docs/superpowers/plans/2026-07-28-google-sign-in.md`, Task 1 (`lib/onboarding/gate.ts`) and Task 2 (the middleware gate wiring) — both must be merged first; this plan only adds a branch to each.
- **Pre-ship dependency, not a code task:** the Meta WhatsApp Authentication-category message template must be created in Meta Business Manager and approved (typically 24–48 hours) before `sendWhatsAppOtp` can send a real message. Every task below compiles and is independently testable without it — `sendWhatsAppOtp` no-ops safely when `META_WHATSAPP_TOKEN`/`META_WHATSAPP_PHONE_NUMBER_ID` are unset, exactly like the existing Termii integration. Do not block merging on template approval; block *going live* on it.
- Existing players are grandfathered — the migration in Task 1 backfills `phone_verified_at = now()` for every profile that predates it, so the gate never fires for a pre-existing account.
- Design source of truth: `docs/superpowers/specs/2026-07-28-google-signin-phone-whatsapp-verification-design.md`, Sections 3 (phone half) and 4.

---

### Task 1: Migration — `phone_verified_at`, `phone_verifications`, grandfathering

**Files:**
- Create: `supabase/migrations/036_phone_whatsapp_verification.sql`
- Modify: `lib/supabase/types.ts` (regenerated, not hand-edited)

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- Phone verification via WhatsApp (Meta Cloud API)
-- =============================================================

ALTER TABLE public.profiles ADD COLUMN phone_verified_at timestamptz;
-- profiles.phone already exists (text, unused by app code until now) —
-- repurposed here to hold the verified, normalized number.

-- Grandfather every account that predates this feature: an active
-- community tournament is running right now, and forcing existing players
-- through a verification wall on their next login — before they can see
-- fixtures or submit a result — for a requirement that didn't exist when
-- they signed up would be a real mid-tournament disruption. Only signups
-- created AFTER this migration runs have a null phone_verified_at and are
-- routed through the onboarding gate; existing players verify voluntarily
-- from their dashboard profile form instead.
UPDATE public.profiles SET phone_verified_at = now() WHERE phone_verified_at IS NULL;

-- One in-flight verification code per user — ephemeral, not permanent
-- profile data. A new request replaces (upserts) any prior pending row.
CREATE TABLE public.phone_verifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  phone       text        NOT NULL,
  code_hash   text        NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user — deliberately no client INSERT/UPDATE/DELETE
-- policy. Writes go exclusively through the service-role admin client inside
-- requestPhoneCode/confirmPhoneCode (lib/phone/actions.ts, Task 3), so a user
-- cannot reset their own `attempts` counter to dodge the lockout.
CREATE POLICY "phone_verifications_own_read" ON public.phone_verifications
  FOR SELECT USING (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration and regenerate types**

Run: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (requires `SUPABASE_URL`/`SUPABASE_ANON_KEY`), or apply via the Supabase MCP `apply_migration` tool against the linked project directly, then regenerate types the same way. Confirm `phone_verifications` and `profiles.phone_verified_at` appear in the regenerated `Database` type.

- [ ] **Step 3: Manually verify the backfill**

Run a read-only check (via the Supabase MCP `execute_sql` tool or the dashboard SQL editor):
```sql
select count(*) from profiles where phone_verified_at is null;
```
Expected: `0` immediately after migration (every existing row backfilled).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/036_phone_whatsapp_verification.sql lib/supabase/types.ts
git commit -m "feat: add phone_verifications table and grandfather existing profiles"
```

---

### Task 2: `sendWhatsAppOtp` — `lib/notifications/whatsapp-cloud-api.ts`

**Files:**
- Create: `lib/notifications/whatsapp-cloud-api.ts`
- Test: `lib/notifications/whatsapp-cloud-api.test.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Produces: `sendWhatsAppOtp(args: { to: string; code: string }): Promise<SendResult>` (reusing the existing `SendResult` shape from `lib/notifications/termii.ts`) — consumed by Task 3 (`requestPhoneCode`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/notifications/whatsapp-cloud-api.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { sendWhatsAppOtp } from './whatsapp-cloud-api'

const originalToken = process.env.META_WHATSAPP_TOKEN
const originalPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
afterEach(() => {
  if (originalToken === undefined) delete process.env.META_WHATSAPP_TOKEN
  else process.env.META_WHATSAPP_TOKEN = originalToken
  if (originalPhoneId === undefined) delete process.env.META_WHATSAPP_PHONE_NUMBER_ID
  else process.env.META_WHATSAPP_PHONE_NUMBER_ID = originalPhoneId
})

describe('sendWhatsAppOtp', () => {
  it('no-ops (skipped) when Meta credentials are not configured', async () => {
    delete process.env.META_WHATSAPP_TOKEN
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID
    const r = await sendWhatsAppOtp({ to: '2348000000000', code: '123456' })
    expect(r).toEqual({ ok: false, skipped: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/notifications/whatsapp-cloud-api.test.ts`
Expected: FAIL — `Cannot find module './whatsapp-cloud-api'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/notifications/whatsapp-cloud-api.ts
export interface SendResult {
  ok: boolean
  providerRef?: string
  error?: string
  skipped?: boolean
}

// Sends a WhatsApp OTP via Meta's own Cloud API — free per-message within
// Meta's monthly allowance, unlike Termii (lib/notifications/termii.ts),
// which charges per message. No-ops when the Meta app isn't configured yet,
// so requestPhoneCode still succeeds harmlessly (skipped) until the
// Business account/template is live — same pattern as sendWhatsApp() in
// termii.ts.
export async function sendWhatsAppOtp(args: { to: string; code: string }): Promise<SendResult> {
  const token = process.env.META_WHATSAPP_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return { ok: false, skipped: true }

  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE ?? 'otp_verification'
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: args.to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          // Assumes a single {{1}} body variable (the code) — Meta's standard
          // Authentication template shape. If the approved template adds
          // extra components (e.g. a one-tap copy-code button), this
          // `components` array must be updated to match it exactly.
          components: [{ type: 'body', parameters: [{ type: 'text', text: args.code }] }],
        },
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
      error?: { message?: string }
    }
    if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` }
    return { ok: true, providerRef: json.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/notifications/whatsapp-cloud-api.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Document the new env vars**

Append to `.env.local.example`, after the existing Termii block:

```
# Phone verification (Meta WhatsApp Cloud API, free tier) — leave blank to
# disable sending (no-op). Requires an approved Authentication-category
# message template in Meta Business Manager.
META_WHATSAPP_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_OTP_TEMPLATE=otp_verification
```

- [ ] **Step 6: Commit**

```bash
git add lib/notifications/whatsapp-cloud-api.ts lib/notifications/whatsapp-cloud-api.test.ts .env.local.example
git commit -m "feat: add Meta WhatsApp Cloud API OTP sender"
```

---

### Task 3: Code hashing — `lib/phone/hash.ts`

**Files:**
- Create: `lib/phone/hash.ts`
- Test: `lib/phone/hash.test.ts`

**Interfaces:**
- Produces: `hashCode(code: string): string`, `codeMatches(code: string, hash: string): boolean` — consumed by Task 4 (`lib/phone/actions.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/phone/hash.test.ts
import { describe, it, expect } from 'vitest'
import { hashCode, codeMatches } from './hash'

describe('hashCode / codeMatches', () => {
  it('is deterministic for the same code', () => {
    expect(hashCode('123456')).toBe(hashCode('123456'))
  })

  it('matches the correct code against its hash', () => {
    expect(codeMatches('123456', hashCode('123456'))).toBe(true)
  })

  it('rejects an incorrect code', () => {
    expect(codeMatches('654321', hashCode('123456'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/phone/hash.test.ts`
Expected: FAIL — `Cannot find module './hash'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/phone/hash.ts
import { createHash, timingSafeEqual } from 'crypto'

// Codes are 6-digit, short-lived (10 min), and rate/attempt-limited
// (lib/phone/actions.ts) — a plain sha256 digest is proportionate; this
// isn't a password store. timingSafeEqual avoids leaking a match via
// response-time comparison.
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function codeMatches(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashCode(code))
  const expected = Buffer.from(hash)
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/phone/hash.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/phone/hash.ts lib/phone/hash.test.ts
git commit -m "feat: add phone verification code hashing"
```

---

### Task 4: `requestPhoneCode` / `confirmPhoneCode` — `lib/phone/actions.ts`

**Files:**
- Create: `lib/phone/schema.ts`
- Create: `lib/phone/actions.ts`

**Interfaces:**
- Consumes: `toWhatsAppNumber` from `lib/dashboard/fixtures.ts` (existing); `sendWhatsAppOtp` (Task 2); `hashCode`, `codeMatches` (Task 3); `createAdminClient` from `lib/supabase/admin.ts` (existing).
- Produces: `requestPhoneCode(_prev, formData): Promise<PhoneActionState>`, `confirmPhoneCode(_prev, formData): Promise<PhoneActionState>`, `type PhoneActionState = { error?: string; success?: boolean } | undefined` — consumed by Task 6 (`PhoneVerifyForm`).

- [ ] **Step 1: Write the code-format schema**

```typescript
// lib/phone/schema.ts
import { z } from 'zod'

export const phoneCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter the 6-digit code')
```

- [ ] **Step 2: Write the two Server Actions**

```typescript
// lib/phone/actions.ts
'use server'
import { randomInt } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'
import { sendWhatsAppOtp } from '@/lib/notifications/whatsapp-cloud-api'
import { phoneCodeSchema } from './schema'
import { hashCode, codeMatches } from './hash'

export type PhoneActionState = { error?: string; success?: boolean } | undefined

const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

export async function requestPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const phone = toWhatsAppNumber(String(formData.get('phone') ?? ''))
  if (!phone) return { error: 'Enter a valid Nigerian phone number.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('phone_verifications')
    .select('created_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing && new Date(existing.created_at).getTime() > Date.now() - RESEND_COOLDOWN_MS) {
    return { error: 'Please wait a minute before requesting another code.' }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const { error } = await admin.from('phone_verifications').upsert(
    {
      user_id: user.id,
      phone,
      code_hash: hashCode(code),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { error: 'Could not send a code. Please try again.' }

  const sent = await sendWhatsAppOtp({ to: phone, code })
  if (!sent.ok && !sent.skipped) return { error: 'Could not send the WhatsApp message. Please try again.' }

  return { success: true }
}

export async function confirmPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const parsed = phoneCodeSchema.safeParse(formData.get('code'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: pending } = await admin
    .from('phone_verifications')
    .select('phone, code_hash, attempts, expires_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!pending) return { error: 'Request a new code first.' }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    return { error: 'That code expired. Request a new one.' }
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    return { error: 'Too many incorrect attempts. Request a new code.' }
  }

  if (!codeMatches(parsed.data, pending.code_hash)) {
    await admin
      .from('phone_verifications')
      .update({ attempts: pending.attempts + 1 })
      .eq('user_id', user.id)
    return { error: 'Incorrect code.' }
  }

  // Single update — both columns together, per the design spec.
  await admin
    .from('profiles')
    .update({ phone: pending.phone, phone_verified_at: new Date().toISOString() })
    .eq('id', user.id)
  await admin.from('phone_verifications').delete().eq('user_id', user.id)

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/phone/schema.ts lib/phone/actions.ts
git commit -m "feat: add requestPhoneCode/confirmPhoneCode server actions"
```

(No dedicated unit test for the actions themselves — they're thin Supabase-calling wrappers around already-tested pure pieces (`toWhatsAppNumber`, `hashCode`/`codeMatches`, `sendWhatsAppOtp`), matching the untested-action convention used throughout this codebase. End-to-end verification happens in Task 6, Step 4.)

---

### Task 5: Extend the onboarding gate with the phone check

**Files:**
- Modify: `lib/onboarding/gate.ts`
- Modify: `lib/onboarding/gate.test.ts`
- Modify: `lib/supabase/middleware.ts`

**Interfaces:**
- Consumes/modifies: `resolveOnboardingGate` from the Google sign-in plan (Task 1 there) — signature changes from `{ username: string | null }` to `{ username: string | null; phoneVerifiedAt: string | null }`; return type gains `'/onboarding/phone'`.

- [ ] **Step 1: Extend the failing tests**

Add to `lib/onboarding/gate.test.ts` (existing two tests must be updated to pass the new `phoneVerifiedAt` field):

```typescript
import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate } from './gate'

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: null })).toBe('/onboarding/username')
  })

  it('routes to phone verification when username is set but phone is not verified', () => {
    expect(resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: null })).toBe('/onboarding/phone')
  })

  it('passes through when both are set', () => {
    expect(
      resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: '2026-07-28T00:00:00.000Z' }),
    ).toBe(null)
  })

  it('checks username before phone', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: '2026-07-28T00:00:00.000Z' })).toBe(
      '/onboarding/username',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: FAIL — the last three tests fail (return type doesn't yet accept/return `/onboarding/phone`).

- [ ] **Step 3: Extend the implementation**

```typescript
// lib/onboarding/gate.ts
export type OnboardingGate = '/onboarding/username' | '/onboarding/phone' | null

export function resolveOnboardingGate(profile: {
  username: string | null
  phoneVerifiedAt: string | null
}): OnboardingGate {
  if (profile.username === null) return '/onboarding/username'
  if (profile.phoneVerifiedAt === null) return '/onboarding/phone'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Update the middleware call site**

In `lib/supabase/middleware.ts`, the `/dashboard` gate block added by the Google sign-in plan currently selects only `username`. Update the select and the `resolveOnboardingGate` call:

```typescript
  if (user && path.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle()
    const gate = resolveOnboardingGate({
      username: profile?.username ?? null,
      phoneVerifiedAt: profile?.phone_verified_at ?? null,
    })
    if (gate) {
      const url = request.nextUrl.clone()
      url.pathname = gate
      url.search = ''
      return NextResponse.redirect(url)
    }
  }
```

- [ ] **Step 6: Manually verify no regression for a grandfathered account**

Run: `npm run dev`, log in with an existing pre-migration test account (grandfathered `phone_verified_at`) and confirm `/dashboard` loads normally with no redirect to `/onboarding/phone`.

- [ ] **Step 7: Commit**

```bash
git add lib/onboarding/gate.ts lib/onboarding/gate.test.ts lib/supabase/middleware.ts
git commit -m "feat: extend the onboarding gate with phone verification"
```

---

### Task 6: `PhoneVerifyForm` + `/onboarding/phone` page + dashboard integration

**Files:**
- Create: `components/onboarding/PhoneVerifyForm.tsx`
- Create: `app/(auth)/onboarding/phone/page.tsx`
- Modify: `components/dashboard/ProfileEditForm.tsx`
- Modify: `app/dashboard/page.tsx` (pass the new prop through to `ProfileEditForm`)

**Interfaces:**
- Consumes: `requestPhoneCode`, `confirmPhoneCode`, `PhoneActionState` (Task 4).

- [ ] **Step 1: Write the shared form component**

```tsx
// components/onboarding/PhoneVerifyForm.tsx
'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { requestPhoneCode, confirmPhoneCode, type PhoneActionState } from '@/lib/phone/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function PhoneVerifyForm({ onVerified }: { onVerified?: () => void }) {
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [requestState, requestAction] = useFormState<PhoneActionState, FormData>(requestPhoneCode, undefined)
  const [confirmState, confirmAction] = useFormState<PhoneActionState, FormData>(confirmPhoneCode, undefined)

  useEffect(() => {
    if (requestState?.success) setStage('code')
  }, [requestState])

  useEffect(() => {
    if (confirmState?.success) onVerified?.()
  }, [confirmState, onVerified])

  if (confirmState?.success) {
    return (
      <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-400">
        ✓ Phone verified.
      </p>
    )
  }

  if (stage === 'code') {
    return (
      <form action={confirmAction} className="space-y-4">
        <p className="text-sm text-slate-400">Enter the 6-digit code we sent on WhatsApp.</p>
        <div className="space-y-1.5">
          <Label htmlFor="code">Code</Label>
          <Input id="code" name="code" inputMode="numeric" maxLength={6} required autoFocus />
        </div>
        {confirmState?.error && <p className="text-sm text-red-400">{confirmState.error}</p>}
        <SubmitButton label="Verify" pendingLabel="Verifying…" />
        <button
          type="button"
          onClick={() => setStage('phone')}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Use a different number
        </button>
      </form>
    )
  }

  return (
    <form action={requestAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" name="phone" type="tel" placeholder="+2348012345678" required autoFocus />
      </div>
      {requestState?.error && <p className="text-sm text-red-400">{requestState.error}</p>}
      <SubmitButton label="Send code" pendingLabel="Sending…" />
    </form>
  )
}
```

- [ ] **Step 2: Write the onboarding page**

```tsx
// app/(auth)/onboarding/phone/page.tsx
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { OnboardingPhoneClient } from './OnboardingPhoneClient'

export const metadata: Metadata = { title: 'Verify your phone · SentinelX Esports' }

export default async function OnboardingPhonePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/phone')

  const { data: profile } = await supabase
    .from('profiles')
    .select('phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.phone_verified_at) redirect('/dashboard')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Verify your phone</h1>
      <p className="mb-6 text-sm text-slate-400">
        We'll send a 6-digit code on WhatsApp so we can reach you about fixtures and results.
      </p>
      <OnboardingPhoneClient />
    </div>
  )
}
```

`onVerified` needs `useRouter`, which requires a client boundary — split into a tiny client wrapper alongside the page:

```tsx
// app/(auth)/onboarding/phone/OnboardingPhoneClient.tsx
'use client'
import { useRouter } from 'next/navigation'
import { PhoneVerifyForm } from '@/components/onboarding/PhoneVerifyForm'

export function OnboardingPhoneClient() {
  const router = useRouter()
  return <PhoneVerifyForm onVerified={() => router.push('/dashboard')} />
}
```

- [ ] **Step 3: Add the voluntary verify option to the dashboard profile form**

In `components/dashboard/ProfileEditForm.tsx`, add `phoneVerifiedAt: string | null` to the `EditableProfile` interface, and render `PhoneVerifyForm` (no `onVerified` — it just shows the "✓ Phone verified" state in place) below the existing WhatsApp-number field when unverified:

```typescript
export interface EditableProfile {
  displayName: string | null
  username: string | null
  avatarUrl: string | null
  whatsapp: string | null
  country: string | null
  bio: string | null
  phoneVerifiedAt: string | null
}
```

Add the import:
```typescript
import { PhoneVerifyForm } from '@/components/onboarding/PhoneVerifyForm'
```

Insert after the closing `</form>` of the existing edit form, still inside the outer `<section>`:
```tsx
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-1 text-sm font-bold text-white">Phone verification</h3>
          {profile.phoneVerifiedAt ? (
            <p className="text-sm text-emerald-400">✓ Verified</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-400">
                Verify a phone number over WhatsApp — helps us reach you about fixtures and results.
              </p>
              <PhoneVerifyForm />
            </>
          )}
        </div>
```

- [ ] **Step 4: Pass `phoneVerifiedAt` through from the dashboard page**

In `app/dashboard/page.tsx`, find the query that builds the `EditableProfile` passed to `<ProfileEditForm profile={...} />`; add `phone_verified_at` to its `select(...)` and thread it through as `phoneVerifiedAt: data.phone_verified_at`.

- [ ] **Step 5: Manually verify both surfaces end-to-end**

Run: `npm run dev`.
1. New-signup path: create a fresh account, confirm redirect to `/onboarding/username` then `/onboarding/phone`, request a code (with Meta credentials unset, confirm it still returns `success: true` — the no-op "skipped" path — and note the actual code in server logs isn't printed anywhere, so this step only confirms the flow doesn't error; full send verification requires Task 2's Meta credentials to be live).
2. Existing-account path: log in as a grandfathered test account, go to `/dashboard`, confirm the "Phone verification" card appears in `ProfileEditForm` with the request/confirm flow working the same way.

- [ ] **Step 6: Commit**

```bash
git add components/onboarding/PhoneVerifyForm.tsx "app/(auth)/onboarding/phone/page.tsx" "app/(auth)/onboarding/phone/OnboardingPhoneClient.tsx" components/dashboard/ProfileEditForm.tsx app/dashboard/page.tsx
git commit -m "feat: add phone verification UI to onboarding and dashboard"
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 (data model + grandfathering) → Task 1. §4.2 (send mechanism + pre-ship template dependency) → Task 2. §4.3 (request/confirm actions, rate limit, attempts, single profiles update) → Tasks 3–4. §3 (phone half of the shared gate) → Task 5. §4.4 (onboarding page + dashboard settings) → Task 6.
- **Placeholder scan:** none found.
- **Type consistency:** `PhoneActionState` defined once (Task 4) and imported unchanged in Task 6. `resolveOnboardingGate`'s extended signature (Task 5) matches its only call site in `lib/supabase/middleware.ts` (also Task 5). `EditableProfile.phoneVerifiedAt` (Task 6, Step 3) matches the field name selected and passed in Task 6, Step 4.
