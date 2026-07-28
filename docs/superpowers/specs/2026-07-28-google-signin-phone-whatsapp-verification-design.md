# Google Sign-In + Phone/WhatsApp Verification — Design Spec

**Date:** 2026-07-28
**Status:** Approved design → ready for implementation plan

---

## 1. Goal

Two independent auth features, brainstormed together because they share one piece of infrastructure (the onboarding gate in Section 3):

1. **Sign in with Google** — an alternative to email/password signup/login, free via Supabase's built-in Google OAuth provider.
2. **Phone verification via WhatsApp** — confirms a player's phone number is real and reachable (catches typos, raises the cost of multi-accounting) by sending a one-time code over WhatsApp using Meta's free-tier Cloud API. Required at signup for new players, and retroactively for existing players on their next login.

Both gate `/dashboard` access via a shared onboarding check in middleware: missing username → missing verified phone → dashboard.

---

## 2. Feature A: Sign in with Google

### 2.1 Provider setup (outside code)

Enable Google in Supabase Auth (Dashboard → Authentication → Providers) using a Google Cloud OAuth 2.0 Web application client (free — no billing needed for `openid email profile` scopes). Add the Client ID/Secret to Supabase.

### 2.2 Callback route

New route `app/auth/oauth/callback/route.ts`, distinct from the existing `app/auth/confirm/route.ts`. This route legitimately calls `supabase.auth.exchangeCodeForSession(code)` — Google's OAuth redirect carries a PKCE `?code=` param that a server route can read, unlike the fragment-based tokens used by the email confirm/recovery link flow that `app/auth/confirm/route.ts` handles (and which CLAUDE.md's `exchangeCodeForSession` warning is about). Add a comment at the top of the file making this distinction explicit so it isn't mistaken for the forbidden pattern later.

The `next` param is sanitized with the existing `safeNext()` helper from `lib/auth/actions.ts` (already strips scheme/host, requires a leading `/`, defaults to `/dashboard`) — reused here, not reimplemented, to avoid an open-redirect vector.

### 2.3 Sign-in button

A `"use client"` component calling:
```ts
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${origin}/auth/oauth/callback?next=${next}` },
})
```
Placed on both `/login` and `/signup`.

### 2.4 Username claim gate

`handle_new_user()` inserts a `profiles` row with `username = NULL` when there's no `username` key in signup metadata (confirmed: `profiles.username` has no `NOT NULL` constraint, only `UNIQUE`). A Google sign-in therefore always produces a profile with a null username. The shared onboarding gate (Section 3) catches this and routes to `/onboarding/username` — a single-field form reusing the existing username-availability check (`useUsernameAvailability` hook, same uniqueness rules as the wizard) — before `/dashboard` is reachable.

### 2.5 Account linking

Supabase auto-links an OAuth identity to an existing user by verified email match by default. Confirm this setting during implementation (Supabase Dashboard → Authentication → Providers) and enable explicitly if needed. Once linked, a player can log in with either their original password or Google, same profile/history/Sentinel Score either way.

---

## 3. Shared onboarding gate

Extend `updateSession()` in `lib/supabase/middleware.ts`. Immediately after the existing session check, when `user` exists and `pathname.startsWith('/dashboard')` (prefix match — covers `/dashboard/wallet`, `/dashboard/settings`, etc., not just the exact path; `/admin` is untouched, staff aren't gated on player onboarding):

1. Select `username, phone_verified_at` from `profiles` for `user.id` (one extra query per request, same cost class as the existing `auth.getUser()` call).
2. `username IS NULL` → redirect to `/onboarding/username`.
3. else `phone_verified_at IS NULL` → redirect to `/onboarding/phone`.
4. else proceed as normal.

`/onboarding/username` and `/onboarding/phone` are excluded from this check (otherwise it loops). Both pages are server components that check for a session at the top and `redirect('/login?next=...')` server-side if absent — a logged-out user hitting either URL directly is bounced before any form renders, no client-side flash.

This gate applies to **every** authenticated player on their next visit to `/dashboard`, including pre-existing accounts created before this feature shipped — not just new signups. Accepted tradeoff: a player mid-tournament may see the phone-verification screen before their fixtures on their next login.

---

## 4. Feature B: Phone verification via WhatsApp

### 4.1 Data model

New migration, adding to `profiles`:
```sql
ALTER TABLE public.profiles ADD COLUMN phone_verified_at timestamptz;
-- profiles.phone already exists (text, currently unused by app code) —
-- repurposed here to hold the verified, normalized number.
```

New table `phone_verifications` (ephemeral — one in-flight code per user, not permanent profile data):
```sql
CREATE TABLE public.phone_verifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  phone       text        NOT NULL,   -- normalized via toWhatsAppNumber(), pre-verification
  code_hash   text        NOT NULL,   -- sha256 — short-lived, low-value code, no need for bcrypt cost
  attempts    integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```
`user_id UNIQUE` — a new code request replaces (upserts) any prior pending row for that user.

RLS: user may **read only their own row** (`FOR SELECT USING (user_id = auth.uid())`). No client-level INSERT/UPDATE policy at all — both `requestPhoneCode` and `confirmPhoneCode` write exclusively through the service-role admin client. This is deliberate: if a user could write their own row, they could reset their own `attempts` counter and defeat the lockout.

### 4.2 Send mechanism — Meta WhatsApp Cloud API

`lib/notifications/whatsapp-cloud-api.ts`, following the same no-op-if-unconfigured pattern as the existing `sendWhatsApp()` in `lib/notifications/termii.ts`:
```ts
export async function sendWhatsAppOtp(args: { to: string; code: string }): Promise<SendResult> {
  const token = process.env.META_WHATSAPP_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return { ok: false, skipped: true }
  // POST graph.facebook.com/v.../{phoneNumberId}/messages
  // template category: Authentication, {{1}} = args.code
}
```
Genuinely free per-message within Meta's Cloud API allowance — no Termii cost.

**Pre-ship dependency (business process, not code):** the Authentication-category message template must be created in Meta Business Manager and approved before any real code can be sent. Typical approval time 24–48 hours. This blocks end-to-end testing of the real send path — it cannot be verified until the template is approved, independent of when the code ships. Track as a checklist item outside the implementation plan, done once, in parallel with development.

### 4.3 Request/confirm actions

`lib/phone/actions.ts`, Server Actions mirroring `lib/auth/actions.ts` conventions:

**`requestPhoneCode(phone)`**
1. Normalize via `toWhatsAppNumber()` (existing helper, `lib/dashboard/fixtures.ts`); reject if unrecognizable.
2. Rate limit: reject if a `phone_verifications` row exists for this user with `created_at > now() - interval '60 seconds'`.
3. Generate a 6-digit code, hash it (sha256), upsert the row (`code_hash`, `phone`, `expires_at = now() + interval '10 minutes'`, `attempts = 0`).
4. Call `sendWhatsAppOtp`.

**`confirmPhoneCode(code)`**
1. Look up the pending row for `user_id`.
2. Reject if missing, expired (`expires_at < now()`), or `attempts >= 5` (must request a new code — no further checks against the locked-out row).
3. Compare hash. On mismatch: increment `attempts`, return error.
4. On match: single `profiles` update setting **both** `phone` (the normalized number from the verification row) and `phone_verified_at = now()` together, then delete the `phone_verifications` row.

### 4.4 UI

- **`/onboarding/phone`** — reached via the shared gate (Section 3), for both new Google/email signups and existing pre-feature accounts. Phone input → "Send code" → 6-digit input → "Verify".
- **Dashboard Settings** — a matching "Phone number" field using the same request/confirm actions, for a player changing a previously-verified number later. Not gated — optional at that point since they already passed onboarding.
- The signup wizard itself (`components/auth/SignupWizard.tsx`) is **unchanged** — phone verification cannot happen pre-email-confirmation because there's no verified identity yet to attach the number to. It happens post-confirmation, via the gate.

---

## 5. Out of scope

- SMS-based OTP fallback (Meta Cloud API / WhatsApp only).
- Re-verifying a phone number if a player's WhatsApp account changes independently of Sentinel X (no periodic re-checks).
- Admin-side onboarding gate (staff are never routed through `/onboarding/*`).
