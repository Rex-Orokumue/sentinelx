# Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can sign in or sign up using their Google account instead of email/password; if their `profiles.username` comes back null (always true for a first-time Google sign-in, since `handle_new_user()` only sets it from signup metadata that Google auth never provides), they're routed to a one-field "claim your username" page before reaching `/dashboard`.

**Architecture:** A new `app/auth/oauth/callback/route.ts` completes Supabase's OAuth PKCE exchange (distinct from the existing email-link `app/auth/confirm/route.ts`, which cannot use this pattern — see Task 4). A pure `resolveOnboardingGate()` function decides whether an authenticated player needs to detour through `/onboarding/username`; `lib/supabase/middleware.ts` calls it for every `/dashboard` request. The username-claim page and form reuse the exact schema and availability-check hook the signup wizard already uses.

**Tech Stack:** Next.js 14 App Router (Server Actions, Route Handlers), Supabase Auth (`@supabase/ssr`), Vitest, TypeScript, Tailwind.

## Global Constraints

- Google OAuth is enabled in the Supabase Dashboard (Authentication → Providers → Google) with a free Google Cloud OAuth 2.0 Web application client — no billing tier required for `openid email profile` scopes. This is manual dashboard/console configuration, covered in Task 6; nothing in Tasks 1–5 depends on it being done first (they compile and the username gate is independently testable without a real Google account).
- `next` redirect targets are sanitized using the existing `resolveCallbackRedirect()` from `lib/auth/redirect.ts` — already tested against open-redirect payloads (`lib/auth/redirect.test.ts`). Do not write a second sanitizer.
- Design source of truth: `docs/superpowers/specs/2026-07-28-google-signin-phone-whatsapp-verification-design.md`, Section 2 and Section 3 (username half only — the phone half of Section 3 is out of scope here, see `docs/superpowers/plans/2026-07-28-phone-whatsapp-verification.md`).

---

### Task 1: `resolveOnboardingGate` — `lib/onboarding/gate.ts`

**Files:**
- Create: `lib/onboarding/gate.ts`
- Test: `lib/onboarding/gate.test.ts`

**Interfaces:**
- Produces: `resolveOnboardingGate(profile: { username: string | null }): '/onboarding/username' | null` — consumed by Task 2 (middleware).

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/onboarding/gate.test.ts
import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate } from './gate'

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null', () => {
    expect(resolveOnboardingGate({ username: null })).toBe('/onboarding/username')
  })

  it('passes through when username is set', () => {
    expect(resolveOnboardingGate({ username: 'davidokafor' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: FAIL — `Cannot find module './gate'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/onboarding/gate.ts
export type OnboardingGate = '/onboarding/username' | null

// Extended in the phone-verification plan to also check phone_verified_at —
// see docs/superpowers/plans/2026-07-28-phone-whatsapp-verification.md.
export function resolveOnboardingGate(profile: { username: string | null }): OnboardingGate {
  return profile.username === null ? '/onboarding/username' : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/gate.ts lib/onboarding/gate.test.ts
git commit -m "feat: add resolveOnboardingGate for the username claim redirect"
```

---

### Task 2: Wire the gate into middleware — `lib/supabase/middleware.ts`

**Files:**
- Modify: `lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: `resolveOnboardingGate` from `lib/onboarding/gate.ts` (Task 1).

- [ ] **Step 1: Modify `updateSession` to check the gate for `/dashboard` requests**

In `lib/supabase/middleware.ts`, add the import and insert the gate check after the existing `PROTECTED`/`AUTH_PAGES` blocks, before `return response`:

```typescript
import { resolveOnboardingGate } from '@/lib/onboarding/gate'
```

```typescript
  if (user && path.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle()
    const gate = resolveOnboardingGate({ username: profile?.username ?? null })
    if (gate) {
      const url = request.nextUrl.clone()
      url.pathname = gate
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return response
```

(`/onboarding/username` itself is never under `/dashboard`, so this cannot loop.)

- [ ] **Step 2: Manually verify no regression for a normal logged-in dashboard visit**

Run: `npm run dev`, log in with an existing test account that already has a username, and confirm `/dashboard` loads normally (no redirect loop, no extra flash). This path isn't unit-testable without a running Supabase instance — `resolveOnboardingGate` already has isolated coverage from Task 1, and this step confirms the wiring, not the logic.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/middleware.ts
git commit -m "feat: gate /dashboard behind the username-claim onboarding check"
```

---

### Task 3: Claim-username Server Action — `lib/onboarding/actions.ts`

**Files:**
- Create: `lib/onboarding/actions.ts`

**Interfaces:**
- Consumes: `usernameSchema` from `lib/auth/schema.ts` (existing).
- Produces: `claimUsername(_prev: ClaimUsernameState, formData: FormData): Promise<ClaimUsernameState>`, `type ClaimUsernameState = { error?: string } | undefined` — consumed by Task 4 (`ClaimUsernameForm`).

- [ ] **Step 1: Write the Server Action**

```typescript
// lib/onboarding/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usernameSchema } from '@/lib/auth/schema'

export type ClaimUsernameState = { error?: string } | undefined

export async function claimUsername(
  _prev: ClaimUsernameState,
  formData: FormData,
): Promise<ClaimUsernameState> {
  const parsed = usernameSchema.safeParse(formData.get('username'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', parsed.data)
    .maybeSingle()
  if (existing) return { error: 'That username is taken — try another.' }

  const { error } = await supabase
    .from('profiles')
    .update({ username: parsed.data, display_name: parsed.data })
    .eq('id', user.id)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'That username is taken — try another.' }
    }
    return { error: 'Could not save your username. Please try again.' }
  }

  redirect('/dashboard')
}
```

This mirrors the exact availability-check-then-insert pattern already used by `signup()` in `lib/auth/actions.ts:35-66`, substituting an UPDATE for the INSERT since the profile row already exists (created by `handle_new_user()` at OAuth sign-in).

- [ ] **Step 2: Commit**

```bash
git add lib/onboarding/actions.ts
git commit -m "feat: add claimUsername server action"
```

(No dedicated unit test — this is a thin Supabase-calling wrapper around already-tested `usernameSchema`, matching the untested-action convention used by `lib/auth/actions.ts` and `lib/profile/actions.ts` throughout this codebase. Manual verification happens in Task 5, Step 2.)

---

### Task 4: `/onboarding/username` page + form

**Files:**
- Create: `components/onboarding/ClaimUsernameForm.tsx`
- Create: `app/(auth)/onboarding/username/page.tsx`

**Interfaces:**
- Consumes: `claimUsername`, `ClaimUsernameState` (Task 3); `useUsernameAvailability` from `hooks/useUsernameAvailability.ts` (existing).

- [ ] **Step 1: Write the form component**

```tsx
// components/onboarding/ClaimUsernameForm.tsx
'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, X, Loader2 } from 'lucide-react'
import { claimUsername, type ClaimUsernameState } from '@/lib/onboarding/actions'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={disabled || pending}>
      {pending ? 'Saving…' : 'Continue'}
    </Button>
  )
}

export function ClaimUsernameForm() {
  const [username, setUsername] = useState('')
  const [state, formAction] = useFormState<ClaimUsernameState, FormData>(claimUsername, undefined)
  const availability = useUsernameAvailability(username)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username-input">Username</Label>
        <div className="relative">
          <Input
            id="username-input"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {availability === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {availability === 'available' && <Check className="h-4 w-4 text-green-500" />}
            {(availability === 'taken' || availability === 'invalid') && <X className="h-4 w-4 text-red-500" />}
          </span>
        </div>
        {availability === 'taken' && <p className="text-sm text-red-400">That username is taken.</p>}
        {availability === 'invalid' && (
          <p className="text-sm text-red-400">3–20 characters: letters, numbers, underscores.</p>
        )}
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton disabled={availability !== 'available'} />
    </form>
  )
}
```

- [ ] **Step 2: Write the page (server-side session guard, no client-side flash)**

```tsx
// app/(auth)/onboarding/username/page.tsx
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ClaimUsernameForm } from '@/components/onboarding/ClaimUsernameForm'

export const metadata: Metadata = { title: 'Choose your username · SentinelX Esports' }

export default async function ClaimUsernamePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.username) redirect('/dashboard')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Choose your handle</h1>
      <p className="mb-6 text-sm text-slate-400">This is your public username on SentinelX Esports.</p>
      <ClaimUsernameForm />
    </div>
  )
}
```

This lives under the `app/(auth)/` route group to reuse `app/(auth)/layout.tsx`'s centered-card shell (same wrapper as `/login` and `/signup`) — the route group doesn't affect the URL, which is `/onboarding/username`.

- [ ] **Step 3: Manually verify the redirect-then-flash-free guard**

Run: `npm run dev`, open `/onboarding/username` in a private/incognito window (no session) and confirm an immediate server-side redirect to `/login?next=/onboarding/username` — the username form must never be visible even for a frame.

- [ ] **Step 4: Commit**

```bash
git add components/onboarding/ClaimUsernameForm.tsx "app/(auth)/onboarding/username/page.tsx"
git commit -m "feat: add /onboarding/username claim page"
```

---

### Task 5: OAuth callback route — `app/auth/oauth/callback/route.ts`

**Files:**
- Create: `app/auth/oauth/callback/route.ts`

**Interfaces:**
- Consumes: `resolveCallbackRedirect` from `lib/auth/redirect.ts` (existing, tested).

- [ ] **Step 1: Write the route handler**

```typescript
// app/auth/oauth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveCallbackRedirect } from '@/lib/auth/redirect'

// OAuth (Google, etc.) callback — DIFFERENT from app/auth/confirm/route.ts.
// Google's redirect carries a PKCE `code` param that a server route CAN
// read, so exchangeCodeForSession is the correct call here. This is NOT the
// pattern CLAUDE.md warns against — that warning is specifically about the
// email confirm/recovery link flow, which returns tokens in the URL
// fragment (unreadable server-side) and must keep using verifyOtp with a
// token_hash instead. Do not merge these two routes.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type: null, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/auth/oauth/callback/route.ts
git commit -m "feat: add OAuth callback route for Google sign-in"
```

---

### Task 6: Google sign-in button + Supabase/Google Cloud setup

**Files:**
- Create: `components/auth/GoogleSignInButton.tsx`
- Modify: `components/auth/LoginForm.tsx`
- Modify: `components/auth/SignupWizard.tsx`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/client.ts` (existing).

- [ ] **Step 1: Write the button component**

```tsx
// components/auth/GoogleSignInButton.tsx
'use client'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function GoogleSignInButton({ next }: { next: string }) {
  async function handleClick() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/oauth/callback?next=${encodeURIComponent(next)}`,
      },
    })
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick}>
      Continue with Google
    </Button>
  )
}
```

- [ ] **Step 2: Wire it into `LoginForm`**

In `components/auth/LoginForm.tsx`, add the import:
```typescript
import { GoogleSignInButton } from './GoogleSignInButton'
```

and insert after the existing `<div className="flex justify-between ...">` links block (before the closing `</form>`):
```tsx
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-slate-800" />
        <span className="text-xs text-slate-500">OR</span>
        <div className="h-px flex-1 bg-slate-800" />
      </div>
      <GoogleSignInButton next={next} />
```

(`next` is already computed at the top of `LoginForm` via `useSearchParams().get('next') ?? '/dashboard'` — reuse the same variable, no new state.)

- [ ] **Step 3: Wire it into `SignupWizard` step 1**

In `components/auth/SignupWizard.tsx`, add the import:
```typescript
import { GoogleSignInButton } from './GoogleSignInButton'
```

and insert inside the `step === 1` block, after the existing `<p className="mt-4 text-center ...">Already have an account?...</p>` paragraph:
```tsx
        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-xs text-slate-500">OR</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="mt-4">
          <GoogleSignInButton next="/dashboard" />
        </div>
```

(Referral attribution (`?ref=`) is carried through the email/password path only — a referred signup via Google is out of scope for this plan; the referral code would need to be threaded through the OAuth `next` param and read back in `handle_new_user()`, which the spec doesn't cover.)

- [ ] **Step 4: Manual setup — Google Cloud + Supabase (must be done before real Google sign-in works end-to-end)**

1. Go to `console.cloud.google.com` → create/select a project → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type: **Web application**.
2. Under **Authorized redirect URIs**, add exactly:
   `https://itxubrkbropttfdackmi.supabase.co/auth/v1/callback`
   (This is Supabase's own fixed callback, not our app's `/auth/oauth/callback` — Supabase completes the Google handshake first, then redirects to our app's `redirectTo`.)
3. Copy the generated **Client ID** and **Client Secret**.
4. In the Supabase Dashboard → **Authentication → Providers → Google**, toggle it on and paste both values in. Confirm the "Callback URL" shown there matches step 2 exactly.
5. Confirm same-email identity auto-linking: in the same Providers settings, check whether manual linking needs to be enabled for automatic linking-by-verified-email to apply (per the design spec, Section 2.5) — enable if it's not already the default behavior.

- [ ] **Step 5: Manually verify the full flow**

Run: `npm run dev`, click "Continue with Google" on `/login`, complete the Google consent screen with a fresh test Google account, and confirm: (a) redirect lands on `/onboarding/username` (new account, null username), (b) submitting a username redirects to `/dashboard`, (c) logging out and back in with the same Google account skips the username page entirely.

- [ ] **Step 6: Commit**

```bash
git add components/auth/GoogleSignInButton.tsx components/auth/LoginForm.tsx components/auth/SignupWizard.tsx
git commit -m "feat: add Google sign-in button to login and signup"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 (provider setup) → Task 6 Step 4. §2.2 (callback route + `next` sanitization) → Task 5. §2.3 (button) → Task 6. §2.4 (username gate) → Tasks 1–4. §2.5 (account linking) → Task 6 Step 4.5. §3 (shared gate, username half) → Tasks 1–2.
- **Placeholder scan:** none found — every step has real code or a concrete manual-verification procedure.
- **Type consistency:** `ClaimUsernameState` defined once in `lib/onboarding/actions.ts` (Task 3) and imported by name, unchanged, in Task 4. `resolveOnboardingGate`'s signature (Task 1) matches its only call site (Task 2).
