# Tournament Detail + Paystack Registration — Design

**Roadmap task:** v1.0 #3 · **Route:** `/tournaments/[slug]`
**Date:** 2026-07-06

## Purpose

Public tournament detail page plus the paid registration flow (₦500 via Paystack).
A player views a tournament, registers, pays on Paystack's hosted checkout, and the
platform reliably records the payment — via a redirect callback **and** an
independent webhook, both funnelling through one idempotent confirmation function.

## Constraints already in place (verified, no migration needed)

- `tournament_registrations`: `UNIQUE (tournament_id, player_id)`,
  `paystack_reference text UNIQUE`.
- RLS: `tr_own_insert` — a player may insert their own row (`auth.uid() = player_id`);
  `tr_staff_update` — normal clients cannot flip `payment_status`; the schema comment
  states transitions "are done via service-role webhooks". So confirmation must use
  the service-role client.
- Env present: `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.

## 1. Detail page — `app/(public)/tournaments/[slug]/page.tsx`

Async Server Component.

- Fetch tournament by slug + `games(name, icon_url, slug)`. `notFound()` if missing
  or `status = 'draft'` (drafts are never public).
- Fetch **paid** registration count (`count: 'exact', head: true`,
  `payment_status = 'paid'`) → capacity display "X / max_players".
- Fetch current user via `auth.getUser()`; if present, fetch their registration row
  for this tournament (RLS `tr_select` allows own rows).
- Render: banner, game label, title, status badge, prize pool, entry fee, format,
  key dates, description, capacity indicator, and the **registration panel**.
- `generateMetadata()` — title/description/OG tags for WhatsApp previews. Completed
  tournaments stay indexable (SEO rule: result pages live permanently).
- "Share on WhatsApp" button (`wa.me/?text=`).
- Reads `?paid=1` / `?payment=failed` search params to show a success/error banner.

### Registration panel — seven CTA states (all approved)

| Condition | UI |
|---|---|
| Not logged in | "Register — ₦500" → `/login?next=/tournaments/[slug]` |
| Logged in · `registration_open` · capacity left · not registered | **Register — ₦500** (submits `registerForTournament`) |
| Registration `pending` | "Complete payment →" (re-initializes, reuses reference) |
| Registration `paid` | "✓ You're registered" + link to dashboard/bracket |
| Capacity full | "Tournament full" (disabled) |
| `registration_closed` / `active` | "Registration closed" + bracket link |
| `completed` | "Tournament ended" + bracket/results link |

The panel is a small client component only where it needs the submit button; status
computation happens server-side and is passed in as props.

## 2. Paystack module — `lib/paystack/`

- `index.ts` (existing) — constants (`PAYSTACK_BASE_URL`, `REGISTRATION_FEE_NGN`).
- `server.ts` (new, **server-only**; reads `PAYSTACK_SECRET_KEY`):
  - `initializeTransaction({ email, amountKobo, reference, callbackUrl, metadata })`
    → POST `/transaction/initialize` → returns `authorization_url`.
  - `verifyTransaction(reference)` → GET `/transaction/verify/:reference` →
    normalized `{ status, amountKobo, reference, ... }`.
  - `verifyWebhookSignature(rawBody, signature)` → HMAC-SHA512 of the raw body with
    the secret, constant-time compare against `x-paystack-signature`.
- Amounts in **kobo** (₦500 → 50000).
- `buildReference(tournamentId, userId)` → `sx_<t8>_<u8>_<rand>`; stored on the row.

## 3. Registration action — `lib/tournaments/actions.ts`

`registerForTournament(tournamentId)` (`'use server'`):

1. `auth.getUser()`; if none → return `{ error }` (button already routes guests to login).
2. Re-fetch tournament server-side; assert `status = 'registration_open'` and paid
   count `< max_players` (never trust the client).
3. Look up existing registration for (tournament, user):
   - `paid` → return "already registered".
   - `pending` → reuse its existing `paystack_reference` (re-initialize).
   - none → insert `payment_status = 'pending'` with a fresh reference (user's own
     session client; RLS `tr_own_insert`).
4. `initializeTransaction({ callbackUrl: ${SITE_URL}/api/paystack/callback, ... })`;
   email from the authed user.
5. `redirect(authorization_url)`.

On initialize failure → return a friendly error; the `pending` row is left intact and
reusable on retry (no dangling `paid` row).

## 4. Confirmation core — `lib/tournaments/confirm.ts`

`confirmRegistration(reference)` — single idempotent source of truth, called by **both**
routes. Returns a typed result: `confirmed | already_paid | not_found | not_successful`.

1. Use the **service-role** Supabase client (server-only; bypasses `tr_staff_update`).
2. Load registration by `paystack_reference`. If already `paid` → return `already_paid`
   (idempotent; double-fire safe).
3. `verifyTransaction(reference)`; require Paystack `status = 'success'` **and**
   `amountKobo === REGISTRATION_FEE_NGN * 100` (guards tampering / partial pay).
   Mismatch → return `not_successful`, leave row `pending`.
4. Update row → `payment_status = 'paid'`.
5. Return `confirmed`.

A service-role client helper lives at `lib/supabase/admin.ts` (new) — uses
`SUPABASE_SERVICE_ROLE_KEY`, never imported by client code.

## 5. Routes

- `app/api/paystack/callback/route.ts` (GET) — Paystack redirects the **user** here
  with `?reference=`. Calls `confirmRegistration`, resolves the tournament slug from
  the registration's tournament, then `redirect`s the browser to
  `/tournaments/[slug]?paid=1` (confirmed/already_paid) or `?payment=failed`
  (not_successful/not_found).
- `app/api/paystack/webhook/route.ts` (POST) — reads the **raw** body,
  `verifyWebhookSignature`; on bad signature → `401`. On `event = 'charge.success'`
  → `confirmRegistration(data.reference)`. Always returns `200` on a well-formed,
  signed request (Paystack retries non-2xx). Machine-to-machine; no redirect.

Both routes are `export const runtime = 'nodejs'` and read the raw request body
(webhook signature requires the exact bytes).

## 6. Error handling summary

| Failure | Behavior |
|---|---|
| Initialize fails | Action returns error; row stays `pending`, reusable |
| Verify not success / amount mismatch | Row stays `pending`; callback → `?payment=failed` |
| Webhook bad signature | `401`, no state change |
| Callback lost (browser closed) | Webhook confirms independently — reliable path |
| Double confirm (callback + webhook) | Second call sees `paid` → `already_paid`, no-op |

## 7. Testing

Vitest units (matching `lib/auth/*.test.ts`):

- `verifyWebhookSignature` — valid / invalid / tampered-body.
- `buildReference` — shape + uniqueness of random segment.
- `confirmRegistration` amount/status branch logic with a mocked `verifyTransaction`
  (success, wrong-amount, not-success) and a mocked registration store — asserts
  idempotency (already-paid short-circuit) and the paid-only-on-valid rule.

Routes + action are integration-tested manually against Paystack **test keys** on the
deployed Vercel URL (localhost redirect/webhook testing is flaky per project notes).

## 8. Files

**New:**
- `app/(public)/tournaments/[slug]/page.tsx`
- `components/tournament/RegistrationPanel.tsx`
- `lib/paystack/server.ts`
- `lib/supabase/admin.ts`
- `lib/tournaments/actions.ts`
- `lib/tournaments/confirm.ts`
- `app/api/paystack/callback/route.ts`
- `app/api/paystack/webhook/route.ts`
- Tests: `lib/paystack/server.test.ts`, `lib/tournaments/confirm.test.ts`

**Touched:** none (constraints + RLS already in place).

## Out of scope (later tasks)

Bracket rendering (#4), dashboard registration list / withdrawals (#8), admin
registration management (#9), WhatsApp registration-confirmation notifications (v2).
The "bracket link" in CTA states points at `/tournaments/[slug]/bracket` (built in #4).
