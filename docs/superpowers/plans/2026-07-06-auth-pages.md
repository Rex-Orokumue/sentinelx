# Auth Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship email + password authentication (login, multi-step signup, forgot/reset password) with session-based route protection, so v1.0 features that require a logged-in user can be built.

**Architecture:** Next.js App Router with Server Actions for all auth mutations (works cleanly with `@supabase/ssr` cookie handling). Pure, unit-tested helpers isolate the two correctness-critical decisions (username-taken detection, callback redirect branching). A `middleware.ts` refreshes the Supabase session on every request and guards protected routes. Signup passes `username` as auth metadata; a DB trigger writes it into `profiles`.

**Tech Stack:** Next.js 14.2, React 18, TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, Tailwind + shadcn/ui, `zod` (new), `vitest` (new, dev).

## Global Constraints

- Mobile-first — design for 375px width, scale up.
- Email confirmation is required (Supabase dashboard toggle is the user's responsibility); build the callback route regardless.
- Username uniqueness is guaranteed only by the DB `UNIQUE` constraint; client-side availability checks are UX only.
- Never expose whether an email exists (no account enumeration) on forgot-password.
- All mutations are Server Actions; no API routes except the OAuth-style callback route handler.
- Username min 3 / max 20 chars, pattern `^[a-zA-Z0-9_]+$`. Password min 8 chars. These exact rules are shared client + server via `zod`.
- `display_name` defaults to the `username` value at signup.
- shadcn components use the existing plain `cn()` from `@/lib/utils` and no `@radix-ui` deps.
- Redirect targets from untrusted params must start with a single `/` (no `//`) — open-redirect guard.

---

### Task 1: Auth logic helpers + test infra (TDD)

Pure, framework-free logic: zod schemas, the username-taken error detector, and the callback redirect resolver. This is where the two flagged correctness concerns live, so they get real unit tests. Sets up vitest + zod (folded in here because this is the first task that needs them).

**Files:**
- Modify: `package.json` (add `zod`, `vitest`; add `test` script)
- Create: `vitest.config.ts`
- Create: `lib/auth/schema.ts`
- Create: `lib/auth/errors.ts`
- Create: `lib/auth/redirect.ts`
- Test: `lib/auth/errors.test.ts`, `lib/auth/redirect.test.ts`, `lib/auth/schema.test.ts`

**Interfaces:**
- Produces:
  - `loginSchema`, `signupSchema`, `requestResetSchema`, `resetPasswordSchema`, `usernameSchema`, `passwordSchema` (zod schemas)
  - `LoginInput`, `SignupInput` (inferred types)
  - `isUsernameTakenError(error: unknown): boolean`
  - `mapSignupError(error: unknown): string`
  - `resolveCallbackRedirect(params: { type: string | null; next: string | null }): string`

- [ ] **Step 1: Install deps and add test script**

Run:
```bash
npm install zod
npm install -D vitest
```
Then edit `package.json` `scripts` to add:
```json
"test": "vitest run"
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Write failing tests for the schemas**

Create `lib/auth/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { usernameSchema, signupSchema, loginSchema } from './schema'

describe('usernameSchema', () => {
  it('accepts a valid handle', () => {
    expect(usernameSchema.safeParse('Rex_99').success).toBe(true)
  })
  it('rejects too short', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
  })
  it('rejects illegal characters', () => {
    expect(usernameSchema.safeParse('bad name!').success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid input', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1' })
    expect(r.success).toBe(true)
  })
  it('rejects short password', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'short' })
    expect(r.success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 5: Implement the schemas**

Create `lib/auth/schema.ts`:
```ts
import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores')

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters')

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

export const signupSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email'),
  password: passwordSchema,
})

export const requestResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
})

export const resetPasswordSchema = z.object({
  password: passwordSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
```

- [ ] **Step 6: Write failing tests for the error detector**

Create `lib/auth/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isUsernameTakenError, mapSignupError } from './errors'

describe('isUsernameTakenError', () => {
  it('detects a raw Postgres 23505 code', () => {
    expect(isUsernameTakenError({ code: '23505' })).toBe(true)
  })
  it('detects the GoTrue-wrapped trigger failure message', () => {
    expect(isUsernameTakenError({ message: 'Database error saving new user' })).toBe(true)
  })
  it('detects a duplicate key message', () => {
    expect(isUsernameTakenError({ message: 'duplicate key value violates unique constraint' })).toBe(true)
  })
  it('ignores unrelated errors', () => {
    expect(isUsernameTakenError({ message: 'Invalid login credentials' })).toBe(false)
  })
  it('is safe on null', () => {
    expect(isUsernameTakenError(null)).toBe(false)
  })
})

describe('mapSignupError', () => {
  it('returns the username-taken message for a 23505', () => {
    expect(mapSignupError({ code: '23505' })).toMatch(/taken/i)
  })
  it('falls back to a generic message otherwise', () => {
    expect(mapSignupError({ message: 'network down' })).toMatch(/something went wrong/i)
  })
})
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 8: Implement the error detector**

Create `lib/auth/errors.ts`:
```ts
// The profiles trigger raises a Postgres unique-violation (23505) when a
// username is already taken during signUp. GoTrue may expose it as a
// structured `code`, or wrap it in a "Database error saving new user"
// message. The only DB constraint the trigger can violate is the username
// UNIQUE index, so we treat any of these signals as "username taken".
export function isUsernameTakenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === '23505') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('database error saving new user') ||
    msg.includes('duplicate key') ||
    msg.includes('unique constraint')
  )
}

export function mapSignupError(error: unknown): string {
  if (isUsernameTakenError(error)) {
    return 'That username is taken — go back and pick another.'
  }
  return 'Something went wrong creating your account. Please try again.'
}
```

- [ ] **Step 9: Write failing tests for the redirect resolver**

Create `lib/auth/redirect.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveCallbackRedirect } from './redirect'

describe('resolveCallbackRedirect', () => {
  it('sends recovery links to the reset-password page', () => {
    expect(resolveCallbackRedirect({ type: 'recovery', next: '/dashboard' })).toBe('/reset-password')
  })
  it('sends signup confirmations to next', () => {
    expect(resolveCallbackRedirect({ type: 'signup', next: '/tournaments' })).toBe('/tournaments')
  })
  it('defaults to /dashboard when next is missing', () => {
    expect(resolveCallbackRedirect({ type: 'signup', next: null })).toBe('/dashboard')
  })
  it('rejects open-redirect targets', () => {
    expect(resolveCallbackRedirect({ type: null, next: '//evil.com' })).toBe('/dashboard')
    expect(resolveCallbackRedirect({ type: null, next: 'https://evil.com' })).toBe('/dashboard')
  })
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './redirect'`.

- [ ] **Step 11: Implement the redirect resolver**

Create `lib/auth/redirect.ts`:
```ts
// Decides where the auth callback sends the user after establishing a session.
// Supabase includes `type` in email links: `recovery` for password resets,
// `signup`/others for email confirmation. Recovery MUST land on the
// reset-password form, not the dashboard.
export function resolveCallbackRedirect(params: {
  type: string | null
  next: string | null
}): string {
  if (params.type === 'recovery') return '/reset-password'
  const next = params.next
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/dashboard'
}
```

- [ ] **Step 12: Run the full suite to verify it passes**

Run: `npm test`
Expected: PASS — all schema, errors, and redirect tests green.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/auth/
git commit -m "feat(auth): add zod schemas, error detector, redirect resolver with tests"
```

---

### Task 2: Signup username metadata migration

New migration replacing `handle_new_user()` so signup metadata populates `username` and `display_name`. `001` is already applied to the live project, so this is additive.

**Files:**
- Create: `supabase/migrations/002_signup_username_metadata.sql`

**Interfaces:**
- Produces: a `profiles` row created on `auth.users` insert with `username` and `display_name` set from `raw_user_meta_data->>'username'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/002_signup_username_metadata.sql`:
```sql
-- Populate username + display_name from signup metadata.
-- The username UNIQUE constraint (from 001) still guarantees uniqueness;
-- a collision raises 23505, which the signup server action maps to a
-- friendly "username is taken" message.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id,
          NEW.raw_user_meta_data->>'username',
          NEW.raw_user_meta_data->>'username')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

- [ ] **Step 2: Apply the migration to the live project**

Run (from repo root):
```bash
npx supabase db push
```
If `db push` prompts for a DB password or is unavailable, instead open the Supabase dashboard → SQL Editor and paste the contents of `supabase/migrations/002_signup_username_metadata.sql`, then Run.

- [ ] **Step 3: Verify the function was updated**

In the Supabase SQL Editor (or `npx supabase db execute`), run:
```sql
select pg_get_functiondef('public.handle_new_user'::regproc);
```
Expected: the returned definition contains `raw_user_meta_data->>'username'` and inserts into `username, display_name`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_signup_username_metadata.sql
git commit -m "feat(auth): trigger writes username + display_name from signup metadata"
```

---

### Task 3: shadcn Input + Label primitives and the auth layout

Shared UI primitives the auth forms need, plus the centered-card layout for the `(auth)` route group. Folded together because the layout is the first consumer and neither is independently testable beyond a build.

**Files:**
- Create: `components/ui/input.tsx`
- Create: `components/ui/label.tsx`
- Create: `app/(auth)/layout.tsx`

**Interfaces:**
- Produces: `Input` (default export-style named `Input`), `Label` — both accept standard HTML props + `className`.

- [ ] **Step 1: Create the Input primitive**

Create `components/ui/input.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white ring-offset-background placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
```

- [ ] **Step 2: Create the Label primitive**

Create `components/ui/label.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium leading-none text-slate-200', className)} {...props} />
  )
)
Label.displayName = 'Label'

export { Label }
```

- [ ] **Step 3: Create the auth layout**

Create `app/(auth)/layout.tsx`:
```tsx
import Link from 'next/link'
import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Image src="/logo-icon.png" alt="Sentinel X" width={40} height={40} />
          <span className="text-2xl font-black tracking-tight">
            SENTINEL <span className="text-violet-400">X</span>
          </span>
        </Link>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add components/ui/input.tsx components/ui/label.tsx "app/(auth)/layout.tsx"
git commit -m "feat(auth): add Input/Label primitives and auth route-group layout"
```

---

### Task 4: Auth server actions

All five mutations. Depends on Task 1 (schemas, `mapSignupError`).

**Files:**
- Create: `lib/auth/actions.ts`

**Interfaces:**
- Consumes: `loginSchema`, `signupSchema`, `requestResetSchema`, `resetPasswordSchema` (Task 1); `mapSignupError` (Task 1); `createClient` from `@/lib/supabase/server`.
- Produces:
  - `type ActionState = { error?: string; success?: string } | undefined`
  - `login(prev: ActionState, formData: FormData): Promise<ActionState>`
  - `signup(prev: ActionState, formData: FormData): Promise<ActionState>` — returns `{ success: 'check-email' }` on success
  - `requestReset(prev: ActionState, formData: FormData): Promise<ActionState>`
  - `resetPassword(prev: ActionState, formData: FormData): Promise<ActionState>`
  - `signOut(): Promise<void>`

- [ ] **Step 1: Implement the server actions**

Create `lib/auth/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  loginSchema,
  signupSchema,
  requestResetSchema,
  resetPasswordSchema,
} from './schema'
import { mapSignupError } from './errors'

export type ActionState = { error?: string; success?: string } | undefined

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: 'Invalid email or password.' }

  revalidatePath('/', 'layout')
  redirect(safeNext(formData.get('next')))
}

export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    username: formData.get('username'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { username, email, password } = parsed.data
  const supabase = createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  })
  if (error) return { error: mapSignupError(error) }

  return { success: 'check-email' }
}

export async function requestReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  })
  // Neutral response regardless of whether the account exists.
  return { success: "If an account exists for that email, we've sent a reset link." }
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Your reset link has expired. Please request a new one.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/actions.ts
git commit -m "feat(auth): add login/signup/reset/signout server actions"
```

---

### Task 5: Auth callback route + session middleware

> **Revised after testing:** the `?code=`/`exchangeCodeForSession` callback at
> `app/auth/callback/route.ts` was replaced with a `token_hash`/`verifyOtp` route at
> `app/auth/confirm/route.ts` (server-side email links return tokens in the URL
> fragment, which `exchangeCodeForSession` can't read — it broke password reset).
> The `verifyOtp` route still consumes `resolveCallbackRedirect` and the middleware is
> unchanged except its matcher now excludes `auth/confirm`. See CLAUDE.md →
> Authentication and the design spec for the final approach.

The email-link callback (branching on `type`) and the middleware that refreshes the session and guards routes. Depends on Task 1 (`resolveCallbackRedirect`).

**Files:**
- Create: `app/auth/callback/route.ts`
- Create: `lib/supabase/middleware.ts`
- Create: `middleware.ts`

**Interfaces:**
- Consumes: `resolveCallbackRedirect` (Task 1); `createClient` from `@/lib/supabase/server`.
- Produces: `updateSession(request: NextRequest): Promise<NextResponse>`

- [ ] **Step 1: Create the callback route**

Create `app/auth/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveCallbackRedirect } from '@/lib/auth/redirect'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
```

> Note: this uses the PKCE `?code=` flow, which is the `@supabase/ssr` default. Ensure the Supabase Auth email templates use the default `{{ .ConfirmationURL }}` (code flow), not a custom `token_hash` template.

- [ ] **Step 2: Create the session updater**

Create `lib/supabase/middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './types'

const PROTECTED = ['/dashboard', '/admin']
const AUTH_PAGES = ['/login', '/signup']

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  if (user && AUTH_PAGES.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}
```

- [ ] **Step 3: Create the middleware entrypoint**

Create `middleware.ts`:
```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/auth/callback/route.ts lib/supabase/middleware.ts middleware.ts
git commit -m "feat(auth): add email callback route and session-refresh middleware"
```

---

### Task 6: Login page

**Files:**
- Create: `components/auth/LoginForm.tsx`
- Create: `app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `login`, `ActionState` (Task 4); `Input`, `Label` (Task 3); `Button` (existing).

- [ ] **Step 1: Create the login form**

Create `components/auth/LoginForm.tsx`:
```tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { login, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Log in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(login, undefined)
  const next = useSearchParams().get('next') ?? '/dashboard'
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
      <div className="flex justify-between text-sm text-slate-400">
        <Link href="/forgot-password" className="hover:text-white">Forgot password?</Link>
        <Link href="/signup" className="hover:text-white">Create account</Link>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create the login page**

Create `app/(auth)/login/page.tsx`:
```tsx
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata: Metadata = { title: 'Log in · Sentinel X' }

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-slate-400">Log in to your Sentinel X account.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
```

> `useSearchParams()` requires the `Suspense` boundary above, or the build fails with a CSR-bailout error.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/auth/LoginForm.tsx "app/(auth)/login/page.tsx"
git commit -m "feat(auth): add login page"
```

---

### Task 7: Signup wizard

Multi-step signup with a debounced username availability check. Depends on Task 4 (`signup`), Task 3 (`Input`/`Label`), Task 1 (`usernameSchema`).

**Files:**
- Create: `hooks/useUsernameAvailability.ts`
- Create: `components/auth/SignupWizard.tsx`
- Create: `app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `signup`, `ActionState` (Task 4); `usernameSchema` (Task 1); `createClient` from `@/lib/supabase/client`.
- Produces: `useUsernameAvailability(username: string): 'idle' | 'checking' | 'available' | 'taken' | 'invalid'`

- [ ] **Step 1: Create the availability hook**

Create `hooks/useUsernameAvailability.ts`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usernameSchema } from '@/lib/auth/schema'

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export function useUsernameAvailability(username: string): Status {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    const parsed = usernameSchema.safeParse(username)
    if (!parsed.success) {
      setStatus(username.length === 0 ? 'idle' : 'invalid')
      return
    }
    setStatus('checking')
    const handle = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', parsed.data)
        .maybeSingle()
      setStatus(data ? 'taken' : 'available')
    }, 400)
    return () => clearTimeout(handle)
  }, [username])

  return status
}
```

- [ ] **Step 2: Create the signup wizard**

Create `components/auth/SignupWizard.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Check, X, Loader2, Eye, EyeOff } from 'lucide-react'
import { signup, type ActionState } from '@/lib/auth/actions'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function Dots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-6 flex justify-center gap-2">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`h-1.5 w-8 rounded-full ${n <= step ? 'bg-violet-500' : 'bg-slate-700'}`} />
      ))}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Creating account…' : 'Create account'}
    </Button>
  )
}

export function SignupWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [username, setUsername] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [state, formAction] = useFormState<ActionState, FormData>(signup, undefined)
  const availability = useUsernameAvailability(username)

  useEffect(() => {
    if (state?.success === 'check-email') setStep(3)
  }, [state])

  if (step === 3) {
    return (
      <div className="text-center">
        <Dots step={3} />
        <h1 className="mb-2 text-xl font-bold">Check your email</h1>
        <p className="text-sm text-slate-400">
          We sent a confirmation link to your inbox. Click it to activate your account, then log in.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction}>
      <Dots step={step} />
      {/* Single source of truth for the submitted username */}
      <input type="hidden" name="username" value={username} />

      {/* Step 1 — username only */}
      <div className={step === 1 ? 'block' : 'hidden'}>
        <h1 className="mb-1 text-xl font-bold">Choose your handle</h1>
        <p className="mb-6 text-sm text-slate-400">This is your public username on Sentinel X.</p>
        <div className="space-y-1.5">
          <Label htmlFor="username-input">Username</Label>
          <div className="relative">
            <Input
              id="username-input"
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
        <Button type="button" className="mt-4 w-full" disabled={availability !== 'available'} onClick={() => setStep(2)}>
          Continue
        </Button>
        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-violet-400 hover:text-violet-300">Log in</Link>
        </p>
      </div>

      {/* Step 2 — email + password */}
      <div className={step === 2 ? 'block' : 'hidden'}>
        <h1 className="mb-1 text-xl font-bold">Create your account</h1>
        <p className="mb-6 text-sm text-slate-400">
          Signing up as <span className="font-semibold text-white">{username}</span>.
        </p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500">At least 8 characters.</p>
          </div>
        </div>
        {state?.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
          <div className="flex-1"><SubmitButton /></div>
        </div>
      </div>
    </form>
  )
}
```

> The visible step-1 input intentionally has **no `name`** — only the single hidden `username` field is submitted, so the value isn't duplicated in the FormData.

- [ ] **Step 3: Create the signup page**

Create `app/(auth)/signup/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { SignupWizard } from '@/components/auth/SignupWizard'

export const metadata: Metadata = { title: 'Sign up · Sentinel X' }

export default function SignupPage() {
  return <SignupWizard />
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/useUsernameAvailability.ts components/auth/SignupWizard.tsx "app/(auth)/signup/page.tsx"
git commit -m "feat(auth): add multi-step signup wizard with username availability check"
```

---

### Task 8: Forgot-password and reset-password pages

**Files:**
- Create: `components/auth/ForgotPasswordForm.tsx`
- Create: `components/auth/ResetPasswordForm.tsx`
- Create: `app/(auth)/forgot-password/page.tsx`
- Create: `app/(auth)/reset-password/page.tsx`

**Interfaces:**
- Consumes: `requestReset`, `resetPassword`, `ActionState` (Task 4); `Input`, `Label` (Task 3); `Button` (existing).

- [ ] **Step 1: Create the forgot-password form**

Create `components/auth/ForgotPasswordForm.tsx`:
```tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Sending…' : 'Send reset link'}
    </Button>
  )
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(requestReset, undefined)
  if (state?.success) {
    return (
      <div>
        <p className="text-sm text-slate-300">{state.success}</p>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Link href="/login" className="hover:text-white">Back to log in</Link>
        </p>
      </div>
    )
  }
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
      <p className="text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-white">Back to log in</Link>
      </p>
    </form>
  )
}
```

- [ ] **Step 2: Create the reset-password form**

Create `components/auth/ResetPasswordForm.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Eye, EyeOff } from 'lucide-react'
import { resetPassword, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Updating…' : 'Set new password'}
    </Button>
  )
}

export function ResetPasswordForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(resetPassword, undefined)
  const [show, setShow] = useState(false)
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-500">At least 8 characters.</p>
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  )
}
```

- [ ] **Step 3: Create the forgot-password page**

Create `app/(auth)/forgot-password/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = { title: 'Forgot password · Sentinel X' }

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-400">Enter your email and we'll send a reset link.</p>
      <ForgotPasswordForm />
    </div>
  )
}
```

- [ ] **Step 4: Create the reset-password page**

Create `app/(auth)/reset-password/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export const metadata: Metadata = { title: 'Set new password · Sentinel X' }

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Set a new password</h1>
      <p className="mb-6 text-sm text-slate-400">Choose a new password for your account.</p>
      <ResetPasswordForm />
    </div>
  )
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/auth/ForgotPasswordForm.tsx components/auth/ResetPasswordForm.tsx "app/(auth)/forgot-password/page.tsx" "app/(auth)/reset-password/page.tsx"
git commit -m "feat(auth): add forgot-password and reset-password pages"
```

---

### Task 9: Auth-aware header

Make the header show Log in vs Dashboard + Sign out, so the auth loop is testable. Depends on Task 4 (`signOut`).

**Files:**
- Create: `components/shared/AuthNav.tsx`
- Modify: `app/layout.tsx` (render `<AuthNav />` in the header nav)

**Interfaces:**
- Consumes: `signOut` (Task 4); `createClient` from `@/lib/supabase/server`.
- Produces: `AuthNav` (async server component).

- [ ] **Step 1: Create AuthNav**

Create `components/shared/AuthNav.tsx`:
```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/lib/auth/actions'

export async function AuthNav() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Log in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/dashboard"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Dashboard
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Render AuthNav in the layout header**

In `app/layout.tsx`, add the import near the other imports:
```tsx
import { AuthNav } from '@/components/shared/AuthNav'
```
Then, inside the header's `<div className="flex items-center gap-1 sm:gap-2">`, add `<AuthNav />` immediately after the closing `</a>` of the WhatsApp Community link (so order is: Tournaments, Rankings, Community, AuthNav):
```tsx
        <AuthNav />
      </div>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/shared/AuthNav.tsx app/layout.tsx
git commit -m "feat(auth): auth-aware header with sign out"
```

---

### Task 10: Full verification

Confirm the whole feature builds and works end-to-end. No new code — verification only.

**Files:** none.

- [ ] **Step 1: Unit tests**

Run: `npm test`
Expected: PASS — all Task 1 suites green.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS — `/login`, `/signup`, `/forgot-password`, `/reset-password` all compile; no CSR-bailout error on `/login`.

- [ ] **Step 4: Manual browser walkthrough**

Confirm Task 2's migration is applied and Supabase Auth → "Confirm email" is ON. Then run `npm run dev` and verify:
1. `/dashboard` while logged out → redirects to `/login?next=/dashboard`.
2. Signup: `/signup` → pick an available username (green ✓) → Continue → email + password → Create account → "check your email" screen.
3. Try signing up a second account with the **same username** (submit directly) → "That username is taken" appears on step 2.
4. Confirm the email link → lands authenticated on `/dashboard` (a placeholder/404 dashboard is fine; the redirect target is what matters).
5. Header now shows Dashboard + Sign out; Sign out returns to `/` and the header shows Log in.
6. Log in with the created account → `/dashboard`.
7. `/forgot-password` → submit email → neutral message → open reset link → lands on `/reset-password` (NOT dashboard) → set new password → `/dashboard`.
8. Logged in, visit `/login` → redirected to `/dashboard`.

- [ ] **Step 5: Final commit (if any doc/tweak changes)**

```bash
git add -A
git commit -m "chore(auth): verification pass for auth pages"
```

- [ ] **Step 6: Update ROADMAP**

In `ROADMAP.md`, change v1.0 row #1 status from ⬜ to ✅. Commit:
```bash
git add ROADMAP.md
git commit -m "docs: mark auth pages done in roadmap"
```

---

## Notes carried from the spec

- Email confirmation depends on a Supabase dashboard toggle (user's action).
- The `002` migration must be applied to the live project (Task 2, Step 2) — the manual walkthrough will fail signup until it is.
- Production email uses Supabase's built-in rate-limited sender; real SMTP is out of scope for this plan.
