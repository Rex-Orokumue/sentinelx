# Auth Pages — Design Spec

**Date:** 2026-07-06
**Roadmap item:** v1.0 #1 — Auth pages (login, signup, forgot password)
**Status:** Approved, pending implementation plan

---

## Goal

Give players email + password authentication so the interactive v1.0 features that
depend on a logged-in user (tournament registration #3, player dashboard #8, admin
dashboard #9) can be built. Scope is authentication only — not the contents of the
protected pages.

## Decisions (locked)

- **Method:** email + password. No OAuth in v1.0 (addable later without rework).
- **Signup:** multi-step wizard.
  - Step 1 — `username` only, with a debounced live availability check against
    `profiles`. This check is **UX only**, never a guarantee.
  - Step 2 — `email` + `password` (show/hide toggle, min-length rule).
  - Step 3 — "check your email" confirmation screen with a resend button.
- **Email confirmation:** required. After signup the user must click the link in
  their email before the session is active. Depends on a Supabase dashboard toggle
  (Auth → Email confirmation), which is the user's to set. The callback route is
  built regardless of the toggle.
- **display_name:** defaults to the `username` value at signup (set via signup
  metadata), editable later in the dashboard.
- **Username persistence:** passed as signup metadata (`options.data.username`) and
  written into `profiles` by the DB trigger. Uniqueness enforced by the existing
  `UNIQUE` constraint on `profiles.username`.
- **Validation stack:** `zod` schemas shared between client and server. Plain
  controlled React state for the wizard (no react-hook-form).
- **Mutations:** Next.js Server Actions (works cleanly with `@supabase/ssr`
  cookies). No separate API routes.

---

## Routes & files

```
app/
  (auth)/
    layout.tsx              # minimal centered-card layout (logo + card, no site nav)
    login/page.tsx          # server shell + client form
    signup/page.tsx         # client multi-step wizard
    forgot-password/page.tsx
    reset-password/page.tsx # reached via email recovery link
  auth/
    callback/route.ts       # exchangeCodeForSession → branch on type → redirect
middleware.ts               # refresh session cookies + guard /dashboard, /admin
lib/auth/
  actions.ts                # server actions: login, signup, requestReset, resetPassword, signOut
  schema.ts                 # zod schemas shared client + server
components/ui/
  input.tsx  label.tsx      # add shadcn primitives (only button.tsx exists today)
```

---

## Auth flows

### Login (`/login`)
Client form → server action `login`. Calls `signInWithPassword`. On success redirect
to `next` param or `/dashboard`. Wrong-credential errors returned to the form as a
generic "invalid email or password" (no distinction between unknown email and wrong
password).

### Signup (`/signup`)
Client wizard. Steps 1–2 are pure client state; Step 3 renders after a successful
submit. Final submit → server action `signup`:

1. Validate `{ username, email, password }` with the shared zod schema.
2. `supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: <site>/auth/callback } })`.
3. **Username uniqueness error handling (required):** the DB trigger inserts the
   profile during `signUp`. If the username is already taken, the trigger's insert
   raises a Postgres unique-violation (code **`23505`**), which rolls back the
   auth.users insert and surfaces as an error on the `signUp` call. The server
   action **must** detect this specific case and return a user-facing message:
   *"That username is taken — go back and pick another."* Detection must be
   defensive: match on the unique-violation signal (Postgres code `23505` and/or the
   GoTrue "Database error saving new user" message wrapper), because GoTrue may wrap
   the underlying Postgres error rather than expose the code cleanly. Any other error
   falls through to a generic failure message. This must not be missed — if it falls
   through generically, users hit a confusing dead end.
4. On success, the wizard advances to Step 3 ("check your email").

Note: because confirmation is on, the auth user (and therefore the reserved username)
is created at signup time, before confirmation. An unconfirmed signup permanently
reserves that username; admin cleanup is acceptable for v1.0.

### Forgot password (`/forgot-password`)
Client form → server action `requestReset` → `resetPasswordForEmail(email, { redirectTo: <site>/auth/callback?next=/reset-password })`.
Always shows a **neutral** message ("If an account exists for that email, we've sent
a reset link") regardless of whether the email exists — no account enumeration.

### Reset password (`/reset-password`)
Reached via the recovery email link, which passes through the callback and
establishes a session. Client form (new password + confirm) → server action
`resetPassword` → `updateUser({ password })` → redirect to `/dashboard`. If there is
no active session (link expired / opened cold), show an error prompting the user to
request a new link.

### Callback (`/auth/callback`)
Route handler. Exchanges the code in the URL for a session
(`exchangeCodeForSession`), then **branches on the `type` query param that Supabase
includes in the email link:**

- **`type=recovery`** → redirect to `/reset-password`.
- **otherwise** (e.g. `type=signup`) → redirect to `next` (default `/dashboard`).

This branch is required. Without it, a password-reset link would redirect the same as
an email-confirmation link and drop the user on the dashboard instead of the
password-reset form.

---

## Database — new migration `002`

`001_initial_schema.sql` is already applied to the live project, so this is a new
migration: **`supabase/migrations/002_signup_username_metadata.sql`**. It replaces
`handle_new_user()` to read the username from signup metadata:

```sql
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

- Uniqueness stays enforced by the existing `UNIQUE` constraint on
  `profiles.username`; a collision raises `23505` (handled in the signup action).
- `ON CONFLICT (id) DO NOTHING` is retained (guards against duplicate id inserts).
- **User action required:** apply this migration to the live project
  (`npx supabase db push`, or paste the SQL in the Supabase SQL editor). The
  implementation plan will include the exact command.

---

## Session & route protection

`middleware.ts`:
- Refreshes the Supabase session cookie on every matched request (required for SSR
  auth to function).
- Redirects unauthenticated users away from `/dashboard` and `/admin` to
  `/login?next=<original path>`.
- Redirects already-authenticated users away from `/login` and `/signup` to
  `/dashboard`.
- Matcher excludes static assets and `/auth/callback`.

---

## Header sign-out (small in-scope add)

The header (`app/layout.tsx`) is currently static, so there would be no way to test
logout. Make it auth-aware:
- Signed out → show **Log in**.
- Signed in → show **Dashboard** + **Sign out** (sign out via the `signOut` server
  action → redirect to `/`).

Kept minimal; just enough to make the auth loop testable.

---

## Explicitly out of scope

- Google / OAuth sign-in.
- Contents of `/dashboard` and `/admin` (guarded by middleware here; built in
  roadmap #8/#9).
- Production SMTP configuration (Supabase built-in sender for now; rate-limited).
- WhatsApp/phone-based auth.

---

## Success criteria

- A new user can sign up (username → email/password → check-email), confirm via
  email, and land authenticated on `/dashboard`.
- A duplicate username at signup produces a clear "username is taken" message, not a
  generic error.
- A user can log in, and a logged-out user is redirected from `/dashboard` to
  `/login`.
- Forgot-password sends a reset link, the recovery link lands on `/reset-password`
  (not the dashboard), and setting a new password logs the user in.
- Sign out returns the user to a signed-out state.
- `npx tsc --noEmit` and `npm run build` pass.
