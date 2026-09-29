# Player Profile Completion, WhatsApp Consent & Game-Interest Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every player a validated E.164 WhatsApp number, a canonical country, an explicit outreach-consent flag, and at least one game interest — collected via a compulsory onboarding gate for new and existing players alike — so admin can filter consenting players by game/country and pull a contact list for manual WhatsApp outreach.

**Architecture:** Two new `profiles` columns (`consent_whatsapp_updates`, `profile_completed_at`) plus a third onboarding-gate step (`/onboarding/profile`), reusing the existing `game_interest` table and `lib/phone/number.ts`'s country-aware phone parser. The same fields become editable afterward via a `Settings` page addition, flow through the mobile `PATCH /me/profile` contract additively, and back a new admin segment/export page.

**Tech Stack:** Next.js 14 App Router + Server Actions, Supabase (Postgres + RLS), Zod, `libphonenumber-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-player-profile-completion-whatsapp-outreach-design.md`

## Global Constraints

- `profiles` is server-only-write — every mutation goes through `createAdminClient()` after a `getUser()` check (CLAUDE.md rule 9). Never `supabase.from('profiles').insert/update/upsert/delete(...)` through the RLS-scoped client — `lib/security/write-paths.test.ts` enforces this by regex scan.
- `consent_whatsapp_updates` is a **private** profile column (admin-client-only reads) — add it to `PRIVATE_PROFILE_COLUMNS` in `lib/security/write-paths.test.ts:24`. `profile_completed_at` is **public** — do not add it there, and it needs a `GRANT SELECT` in the migration.
- Never `select('*')` on `profiles` (`lib/security/write-paths.test.ts` also forbids this).
- New migration file: `supabase/migrations/20260929120000_add_profile_completion_fields.sql` — UTC-timestamp prefix, not a sequential number (see CLAUDE.md's migration-naming rule; latest existing migration is `20260928130000_tournament_match_type_fk.sql`).
- `supabase gen types` cannot run in this environment (no live project creds) — hand-edit `lib/supabase/types.ts` in the exact shape the generator would produce, matching the precedent in commit `8ebed5e` ("chore(types): hand-add game_registration_fields/registration_details types").
- `consent_whatsapp_updates` must never be coerced to `true` — a genuine "no" is a valid, final answer. Never default it to `true` anywhere in the stack.
- Mobile API endpoints under `app/api/mobile/v1/**` are never hand-written route handlers — `meEndpoint`/`updateProfileEndpoint` in `lib/mobile-api/endpoints/me.ts` already use `defineEndpoint()`; keep using it.
- Any additive change to the mobile API response/body shape requires `npm run openapi` and committing the regenerated `openapi/mobile-v1.json` (CLAUDE.md rule 11).
- Not in scope: the automated Termii WhatsApp pipeline (`notification_prefs.whatsapp.*`), the disabled phone-OTP system (`ENFORCE_PHONE_VERIFICATION`), tournament-to-interest matching, or any `SignupWizard.tsx` change.

## Review Focus

- **A player whose `profiles.country` is a legacy free-text value** ("Nigerian", "naija", empty string) hits the new gate — `parsePlayerPhone`/`countryToRegion` must still resolve it via the existing alias table, not reject a previously-valid-looking number just because the new gate now runs validation that never ran before. Covered in Task 7's service tests (country alias round-trip) and Task 6's schema tests.
- **A player re-submits the onboarding-profile form after unchecking every game** — `gameInterests.min(1, ...)` must reject this with a field error, not silently save zero interests (defeats the "every player has at least one game_interest row" goal). Covered in Task 6.
- **The consent checkbox is left unchecked** — because a bare `<input type="checkbox">` omits itself from `FormData` when unchecked, an unchecked box must still arrive as the literal string `'false'`, not be indistinguishable from "field never submitted." Covered in Task 6 (schema) and Task 8 (the actual `<form>` submission, mirrored checkbox + hidden input).
- **Settings edit omits `gameInterests`/`consentWhatsappUpdates` from the FormData/JSON body entirely** (a mobile client patching only `displayName`) — must leave existing `game_interest` rows and `consent_whatsapp_updates` value untouched, never wipe them to empty/false. Covered in Task 10 (service) and Task 11 (the real `FormData` mapping in the Server Action, not just the Zod schema unit test — see `[[feedback_test_the_formdata_path]]`: a schema test alone would miss a field the hand-written FormData mapping forgot to read).
- **Admin segment page filters by a country string typed as free text on one of the 8 whatsapp-consenting rows but not the others** — the country filter must match `profiles.country` exactly as stored (no normalization at query time), and a player with zero matching countries must not appear; a player consenting but interested in zero of the filtered games must not appear either. Covered in Task 14's grouping/filter tests.

---

## Task 1: Schema migration, generated types, and the private-column ratchet

**Files:**
- Create: `supabase/migrations/20260929120000_add_profile_completion_fields.sql`
- Modify: `lib/supabase/types.ts:2697-2809` (the `profiles` table's `Row`/`Insert`/`Update`/nothing-else — `Relationships` is unchanged)
- Modify: `lib/security/write-paths.test.ts:24`

**Interfaces:**
- Produces: `profiles.consent_whatsapp_updates: boolean` (private column, default `false`), `profiles.profile_completed_at: string | null` (public column) — every later task in this plan reads/writes these two columns.

- [ ] **Step 1: Write the migration**

```sql
-- 20260929120000_add_profile_completion_fields.sql
-- Spec: docs/superpowers/specs/2026-09-29-player-profile-completion-whatsapp-outreach-design.md
ALTER TABLE public.profiles ADD COLUMN consent_whatsapp_updates boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN profile_completed_at timestamptz;

-- Public: middleware's RLS-scoped client needs to read this to drive the
-- onboarding gate, same reasoning as phone_verified_at. Column grants are
-- additive, so this doesn't need to restate the full allow-list from
-- 20260918200000_lock_down_profiles_and_write_paths.sql.
GRANT SELECT (profile_completed_at) ON public.profiles TO anon, authenticated;

-- consent_whatsapp_updates is NOT granted here — private, admin-client-only
-- reads, same as whatsapp_number.

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Hand-add the two columns to the generated types**

In `lib/supabase/types.ts`, inside the `profiles` table block (starts line 2697), add to `Row` (alphabetical, between `bio` and `country`, and between `phone_verified_at` and `referred_by`):

```ts
          consent_whatsapp_updates: boolean
```
(inserted right after `bio: string | null` on line 2700, before `country: string | null`)

```ts
          profile_completed_at: string | null
```
(inserted right after `phone_verified_at: string | null` on line 2719, before `referred_by: string | null`)

Repeat the same two insertions (with `?` optionality matching the surrounding style — `consent_whatsapp_updates?: boolean`, `profile_completed_at?: string | null`) in the `Insert` block (lines 2732-2765) and the `Update` block (lines 2766-2799).

- [ ] **Step 3: Add the new column to the private-column ratchet**

In `lib/security/write-paths.test.ts:24`:

```ts
const PRIVATE_PROFILE_COLUMNS = ['phone', 'whatsapp_number', 'notification_prefs', 'referred_by', 'deletion_requested_at', 'consent_whatsapp_updates']
```

- [ ] **Step 4: Run the write-paths test to confirm the ratchet still passes**

Run: `npx vitest run lib/security/write-paths.test.ts`
Expected: PASS (no code yet references `consent_whatsapp_updates` through the `supabase` client, so nothing new trips the scan)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260929120000_add_profile_completion_fields.sql lib/supabase/types.ts lib/security/write-paths.test.ts
git commit -m "feat(db): add profiles.consent_whatsapp_updates and profile_completed_at"
```

---

## Task 2: `listCountries()` helper

**Files:**
- Modify: `lib/phone/number.ts` (append, after `countryToRegion`, before the `PlayerPhone` interface — i.e. after line 83)
- Test: `lib/phone/number.test.ts` (create if it doesn't already exist — check first with `Read`; if it exists, append a new `describe` block)

**Interfaces:**
- Consumes: `getCountries()` from `libphonenumber-js` (already imported in this file, line 1), `CountryCode` type (already imported).
- Produces: `listCountries(): { code: CountryCode; name: string }[]` — sorted by display name — consumed by Task 8 (onboarding page's country `<select>`).

- [ ] **Step 1: Check for an existing test file**

Run: `ls lib/phone/*.test.ts` (or use the Read tool on `lib/phone/number.test.ts`)
If it exists, read it fully before editing so Step 2 appends rather than clobbers.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { listCountries } from './number'

describe('listCountries', () => {
  it('returns every ISO country code with a display name, sorted alphabetically by name', () => {
    const countries = listCountries()
    expect(countries.length).toBeGreaterThan(200)
    expect(countries).toContainEqual({ code: 'NG', name: 'Nigeria' })
    const names = countries.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('has no duplicate codes', () => {
    const codes = listCountries().map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/phone/number.test.ts`
Expected: FAIL with "listCountries is not a function" (or module has no export)

- [ ] **Step 4: Implement `listCountries()`**

In `lib/phone/number.ts`, after `countryToRegion` (after line 83):

```ts
/** Every ISO country as a `{code, name}` pair, sorted by display name — backs the onboarding/Settings country `<select>`. */
export function listCountries(): { code: CountryCode; name: string }[] {
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  return getCountries()
    .map((code) => ({ code, name: display.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/phone/number.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/phone/number.ts lib/phone/number.test.ts
git commit -m "feat(phone): add listCountries() for the country dropdown"
```

---

## Task 3: `replaceGameInterests()` service

**Files:**
- Create: `lib/games/game-interest-service.ts`
- Test: `lib/games/game-interest-service.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient<Database>` (session-scoped — `game_interest` already grants `authenticated` insert/delete on own rows per `048_game_interest.sql:17-23`, no admin escalation needed).
- Produces: `replaceGameInterests(supabase, userId, gameIds): Promise<{ok: true} | {ok: false}>` — consumed by Task 7 (onboarding action) and Task 10 (settings service).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { replaceGameInterests } from './game-interest-service'

function fakeSupabase(opts: { delError?: object | null; insError?: object | null } = {}) {
  const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: opts.delError ?? null }) }))
  const insert = vi.fn().mockResolvedValue({ error: opts.insError ?? null })
  const from = vi.fn((table: string) => {
    if (table !== 'game_interest') throw new Error(`unexpected table ${table}`)
    return { delete: del, insert }
  })
  return { supabase: { from } as never, del, insert }
}

describe('replaceGameInterests', () => {
  it('deletes existing rows then inserts the new set', async () => {
    const { supabase, del, insert } = fakeSupabase()
    const result = await replaceGameInterests(supabase, 'u1', ['g1', 'g2'])
    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith([
      { user_id: 'u1', game_id: 'g1' },
      { user_id: 'u1', game_id: 'g2' },
    ])
  })

  it('clears all interests when given an empty array, without an insert call', async () => {
    const { supabase, del, insert } = fakeSupabase()
    const result = await replaceGameInterests(supabase, 'u1', [])
    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('is safe to call twice with the same set (delete+reinsert, not an error)', async () => {
    const { supabase } = fakeSupabase()
    const first = await replaceGameInterests(supabase, 'u1', ['g1'])
    const second = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
  })

  it('reports failure when the delete errors, without attempting the insert', async () => {
    const { supabase, insert } = fakeSupabase({ delError: { message: 'boom' } })
    const result = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(result).toEqual({ ok: false })
    expect(insert).not.toHaveBeenCalled()
  })

  it('reports failure when the insert errors', async () => {
    const { supabase } = fakeSupabase({ insError: { message: 'boom' } })
    const result = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(result).toEqual({ ok: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/games/game-interest-service.test.ts`
Expected: FAIL (module `./game-interest-service` doesn't exist yet)

- [ ] **Step 3: Implement `replaceGameInterests()`**

```ts
// lib/games/game-interest-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// Full-replace semantics (delete-then-insert), not an append log — the
// checklist represents current interest, not a click history. Session-scoped
// client: game_interest already grants authenticated users insert/delete on
// their own rows (048_game_interest.sql), no admin escalation needed.
export async function replaceGameInterests(
  supabase: SupabaseClient<Database>,
  userId: string,
  gameIds: string[],
): Promise<{ ok: true } | { ok: false }> {
  const { error: delError } = await supabase.from('game_interest').delete().eq('user_id', userId)
  if (delError) return { ok: false }
  if (gameIds.length === 0) return { ok: true }
  const { error: insError } = await supabase
    .from('game_interest')
    .insert(gameIds.map((game_id) => ({ user_id: userId, game_id })))
  return insError ? { ok: false } : { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/games/game-interest-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/games/game-interest-service.ts lib/games/game-interest-service.test.ts
git commit -m "feat(games): add replaceGameInterests() full-replace helper"
```

---

## Task 4: Extend the onboarding gate to a three-way chain

**Files:**
- Modify: `lib/onboarding/gate.ts` (entire file)
- Modify: `lib/onboarding/gate.test.ts` (entire file)

**Interfaces:**
- Produces: `OnboardingGate = '/onboarding/username' | '/onboarding/phone' | '/onboarding/profile' | null`, `resolveOnboardingGate(profile: {username, phoneVerifiedAt, profileCompletedAt}): OnboardingGate` — consumed by Task 5 (middleware) and Task 8's page (`redirect('/dashboard')` guard mirrors this priority).

- [ ] **Step 1: Update the failing/changed tests first**

Replace the full contents of `lib/onboarding/gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate, ENFORCE_PHONE_VERIFICATION } from './gate'

const base = { username: 'davidokafor', phoneVerifiedAt: null, profileCompletedAt: null }

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null, regardless of the other fields', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: null, profileCompletedAt: null })).toBe(
      '/onboarding/username',
    )
    expect(
      resolveOnboardingGate({
        username: null,
        phoneVerifiedAt: '2026-07-28T00:00:00.000Z',
        profileCompletedAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toBe('/onboarding/username')
  })

  it('routes to profile completion when username is set and profile is incomplete (phone verification currently unenforced)', () => {
    expect(resolveOnboardingGate(base)).toBe('/onboarding/profile')
  })

  it('passes through when username is set and profile is complete', () => {
    expect(resolveOnboardingGate({ ...base, profileCompletedAt: '2026-09-29T00:00:00.000Z' })).toBe(null)
  })

  // Documents current intent — flip ENFORCE_PHONE_VERIFICATION to true once
  // Meta WhatsApp is live, and restore a test asserting an unverified phone
  // routes to '/onboarding/phone' when username is set but phone isn't.
  it('phone verification enforcement is currently disabled', () => {
    expect(ENFORCE_PHONE_VERIFICATION).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: FAIL — `resolveOnboardingGate` doesn't accept/return the new shape yet (TS type error surfaces as a test failure since `profileCompletedAt` doesn't exist on the current parameter type; if the project's TS settings don't hard-fail vitest on this, the third test's assertion will still fail because current code returns `null` for `base`, not `/onboarding/profile`).

- [ ] **Step 3: Extend the gate**

Replace `lib/onboarding/gate.ts` in full:

```ts
export type OnboardingGate = '/onboarding/username' | '/onboarding/phone' | '/onboarding/profile' | null

// Phone verification is fully built (lib/phone/*, /onboarding/phone, the
// dashboard settings card) but not enforced yet — the Meta WhatsApp Business
// Manager setup (app, business verification, Authentication template
// approval) is a manual, separate task that's been deferred. Flip this to
// true once that's done and META_WHATSAPP_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID
// are live; see docs/superpowers/specs/2026-07-28-google-signin-phone-whatsapp-verification-design.md.
export const ENFORCE_PHONE_VERIFICATION = false

export function resolveOnboardingGate(profile: {
  username: string | null
  phoneVerifiedAt: string | null
  profileCompletedAt: string | null
}): OnboardingGate {
  if (profile.username === null) return '/onboarding/username'
  if (ENFORCE_PHONE_VERIFICATION && profile.phoneVerifiedAt === null) return '/onboarding/phone'
  if (profile.profileCompletedAt === null) return '/onboarding/profile'
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/onboarding/gate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/gate.ts lib/onboarding/gate.test.ts
git commit -m "feat(onboarding): extend the gate chain with a compulsory profile step"
```

---

## Task 5: Wire the gate into middleware

**Files:**
- Modify: `lib/supabase/middleware.ts:42,54,127-134`
- Modify: `lib/supabase/middleware.test.ts` (extend the mock at lines 6-11 and the assertion in the third test, lines 32-39)

**Interfaces:**
- Consumes: `resolveOnboardingGate` from Task 4 (already imported, line 4 — no import change needed).
- Produces: nothing new consumed elsewhere — this is the last wiring point for the gate chain.

- [ ] **Step 1: Extend the middleware test to capture the select() call and cover the new field**

In `lib/supabase/middleware.test.ts`, replace the mock block (lines 4-12):

```ts
const getSession = vi.fn()
const maybeSingle = vi.fn()
const select = vi.fn(() => ({ eq: () => ({ maybeSingle }) }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getSession },
    from: () => ({ select }),
  }),
}))
vi.mock('@/lib/onboarding/gate', () => ({ resolveOnboardingGate: () => null }))
```

Then extend the third test (lines 32-39) to assert the new column is fetched and passed through:

```ts
  it('does not redirect an authenticated request to a protected path, and fetches profile_completed_at alongside the existing columns', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } })
    maybeSingle.mockResolvedValueOnce({ data: { username: 'x', phone_verified_at: '2026-01-01', profile_completed_at: '2026-01-01' } })
    const { updateSession } = await import('./middleware')
    const request = new NextRequest('https://sentinelx.gg/fr/dashboard')
    const result = await updateSession(request, '/dashboard', 'fr')
    expect(result.redirected).toBe(false)
    expect(select).toHaveBeenCalledWith('username, phone_verified_at, profile_completed_at')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/middleware.test.ts`
Expected: FAIL on the new `select` assertion (current code selects only `'username, phone_verified_at'`)

- [ ] **Step 3: Extend the middleware**

In `lib/supabase/middleware.ts`, line 42:

```ts
type OnboardingProfile = { username: string | null; phone_verified_at: string | null; profile_completed_at: string | null }
```

Line 54 (inside `onboardingProfile()`):

```ts
      supabase.from('profiles').select('username, phone_verified_at, profile_completed_at').eq('id', userId).maybeSingle(),
```

Line 58 (the `.maybeSingle()` fallback default):

```ts
    return result.data ?? { username: null, phone_verified_at: null, profile_completed_at: null }
```

Lines 129-132 (the `resolveOnboardingGate` call):

```ts
      const gate = resolveOnboardingGate({
        username: profile.username,
        phoneVerifiedAt: profile.phone_verified_at,
        profileCompletedAt: profile.profile_completed_at,
      })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/middleware.test.ts`
Expected: PASS (all existing tests too — they mock `resolveOnboardingGate` to always return `null`, so the three-way chain's actual logic isn't exercised here, only the wiring)

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/middleware.ts lib/supabase/middleware.test.ts
git commit -m "feat(onboarding): wire profile_completed_at into the middleware gate check"
```

---

## Task 6: Onboarding-profile Zod schema + FormData parser

**Files:**
- Create: `lib/onboarding/profile-schema.ts`
- Test: `lib/onboarding/profile-schema.test.ts`

**Interfaces:**
- Produces: `onboardingProfileSchema: ZodSchema`, `OnboardingProfileInput` (inferred type), `parseOnboardingProfileFormData(formData: FormData): unknown` — consumed by Task 7's service and Task 8's Server Action. `parseOnboardingProfileFormData` exists as its own tested function specifically so the FormData→schema-input mapping (the repeated `gameInterests` key, the hidden-input consent string) is exercised by a real `FormData` object, not just the Zod schema in isolation (see `[[feedback_test_the_formdata_path]]`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { onboardingProfileSchema, parseOnboardingProfileFormData } from './profile-schema'

describe('onboardingProfileSchema', () => {
  const valid = {
    country: 'Nigeria',
    whatsapp: '08012345678',
    consentWhatsappUpdates: 'true' as const,
    gameInterests: ['11111111-1111-1111-1111-111111111111'],
  }

  it('accepts a fully filled submission', () => {
    expect(onboardingProfileSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a blank country', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, country: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank whatsapp number', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, whatsapp: '' })
    expect(result.success).toBe(false)
  })

  it('rejects zero game interests', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, gameInterests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid game interest', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, gameInterests: ['not-a-uuid'] })
    expect(result.success).toBe(false)
  })

  it('accepts consent as the literal string "false" (an explicit no is valid)', () => {
    expect(onboardingProfileSchema.safeParse({ ...valid, consentWhatsappUpdates: 'false' }).success).toBe(true)
  })

  it('rejects consent as anything other than the strings "true"/"false"', () => {
    expect(onboardingProfileSchema.safeParse({ ...valid, consentWhatsappUpdates: undefined }).success).toBe(false)
  })
})

describe('parseOnboardingProfileFormData', () => {
  it('reads a single-select country/whatsapp, repeated gameInterests entries, and the consent hidden input', () => {
    const fd = new FormData()
    fd.set('country', 'Ghana')
    fd.set('whatsapp', '0244123456')
    fd.set('consentWhatsappUpdates', 'true')
    fd.append('gameInterests', '11111111-1111-1111-1111-111111111111')
    fd.append('gameInterests', '22222222-2222-2222-2222-222222222222')

    expect(parseOnboardingProfileFormData(fd)).toEqual({
      country: 'Ghana',
      whatsapp: '0244123456',
      consentWhatsappUpdates: 'true',
      gameInterests: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    })
  })

  it('produces an empty gameInterests array (not undefined) when no checkbox was checked', () => {
    const fd = new FormData()
    fd.set('country', 'Ghana')
    fd.set('whatsapp', '0244123456')
    fd.set('consentWhatsappUpdates', 'false')
    expect(parseOnboardingProfileFormData(fd)).toMatchObject({ gameInterests: [] })
  })

  it('defaults missing country/whatsapp/consent to empty strings rather than throwing', () => {
    const fd = new FormData()
    expect(parseOnboardingProfileFormData(fd)).toEqual({
      country: '',
      whatsapp: '',
      consentWhatsappUpdates: '',
      gameInterests: [],
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/onboarding/profile-schema.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement the schema and FormData parser**

```ts
// lib/onboarding/profile-schema.ts
import { z } from 'zod'

export const onboardingProfileSchema = z.object({
  country: z.string().trim().min(1, 'Select your country'),
  whatsapp: z.string().trim().min(1, 'Enter your WhatsApp number'),
  consentWhatsappUpdates: z.enum(['true', 'false']), // hidden input is always a string
  gameInterests: z.array(z.string().uuid()).min(1, 'Select at least one game'),
})

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>

// gameInterests arrives as repeated FormData entries under one key (one per
// checked game checkbox). Extracted as its own function so the actual
// FormData-reading logic — not just the schema it feeds — has a test with a
// real FormData object exercising it.
export function parseOnboardingProfileFormData(formData: FormData) {
  return {
    country: String(formData.get('country') ?? ''),
    whatsapp: String(formData.get('whatsapp') ?? ''),
    consentWhatsappUpdates: String(formData.get('consentWhatsappUpdates') ?? ''),
    gameInterests: formData.getAll('gameInterests').map(String),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/onboarding/profile-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/profile-schema.ts lib/onboarding/profile-schema.test.ts
git commit -m "feat(onboarding): add the onboarding-profile schema and FormData parser"
```

---

## Task 7: `completeProfileOnboarding()` service + Server Action

**Files:**
- Create: `lib/onboarding/profile-completion-service.ts`
- Test: `lib/onboarding/profile-completion-service.test.ts`
- Modify: `lib/onboarding/actions.ts` (append the new action)

**Interfaces:**
- Consumes: `onboardingProfileSchema`/`parseOnboardingProfileFormData` (Task 6), `parsePlayerPhone` from `lib/phone/number.ts` (existing), `replaceGameInterests` (Task 3), `safeInternalPath` (existing, `lib/onboarding/safe-path.ts`).
- Produces: `performCompleteProfileOnboarding(supabase, admin, userId, input): Promise<{ok: true} | {ok: false, errorCode: ...}>` and the `completeProfileOnboarding` Server Action — consumed by Task 8's client form.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { performCompleteProfileOnboarding } from './profile-completion-service'

function fakeSupabase() {
  const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  const insert = vi.fn().mockResolvedValue({ error: null })
  return {
    from: (table: string) => {
      if (table !== 'game_interest') throw new Error(`unexpected table ${table}`)
      return { delete: del, insert }
    },
  } as never
}

function fakeAdmin(opts: { updateError?: object | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq }))
  return { admin: { from: (table: string) => { if (table !== 'profiles') throw new Error(`unexpected table ${table}`); return { update } } } as never, update }
}

const GAME_ID = '11111111-1111-1111-1111-111111111111'
const validInput = { country: 'Nigeria', whatsapp: '08012345678', consentWhatsappUpdates: 'true' as const, gameInterests: [GAME_ID] }

describe('performCompleteProfileOnboarding', () => {
  it('rejects an invalid submission without touching the database', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, gameInterests: [] })
    expect(result.ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a number that is invalid for the selected country (South African shape against Nigeria)', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, whatsapp: '0821234567' })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_whatsapp' })
    expect(update).not.toHaveBeenCalled()
  })

  it('resolves a legacy free-text country ("Nigerian") via the existing alias table', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, country: 'Nigerian' })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ country: 'Nigerian', whatsapp_number: '+2348012345678' }))
  })

  it('stores E.164, stamps profile_completed_at, and replaces game interests on success', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', validInput)
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({
      country: 'Nigeria',
      whatsapp_number: '+2348012345678',
      consent_whatsapp_updates: true,
      profile_completed_at: expect.any(String),
    })
  })

  it('stores consent as false for an explicit no', async () => {
    const { admin, update } = fakeAdmin()
    await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, consentWhatsappUpdates: 'false' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consent_whatsapp_updates: false }))
  })

  it('reports save_failed when the profiles update errors', async () => {
    const { admin } = fakeAdmin({ updateError: { message: 'boom' } })
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', validInput)
    expect(result).toEqual({ ok: false, errorCode: 'save_failed' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/onboarding/profile-completion-service.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement the service**

```ts
// lib/onboarding/profile-completion-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { onboardingProfileSchema } from './profile-schema'
import { parsePlayerPhone } from '@/lib/phone/number'
import { replaceGameInterests } from '@/lib/games/game-interest-service'

export type CompleteProfileOnboardingErrorCode = 'invalid_input' | 'invalid_whatsapp' | 'save_failed'
export type CompleteProfileOnboardingResult = { ok: true } | { ok: false; errorCode: CompleteProfileOnboardingErrorCode }

// Extracted from lib/onboarding/actions.ts's completeProfileOnboarding() so
// the validation + write logic has a test surface independent of FormData
// and Next's 'use server' plumbing.
export async function performCompleteProfileOnboarding(
  supabase: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rawInput: unknown,
): Promise<CompleteProfileOnboardingResult> {
  const parsed = onboardingProfileSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, errorCode: 'invalid_input' }

  const phone = parsePlayerPhone(parsed.data.whatsapp, { country: parsed.data.country })
  if (!phone) return { ok: false, errorCode: 'invalid_whatsapp' }

  // profiles is server-only-write (CLAUDE.md rule 9) — service role required.
  const { error } = await admin
    .from('profiles')
    .update({
      country: parsed.data.country,
      whatsapp_number: phone.e164,
      consent_whatsapp_updates: parsed.data.consentWhatsappUpdates === 'true',
      profile_completed_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) return { ok: false, errorCode: 'save_failed' }

  // game_interest already grants authenticated insert/delete on own rows —
  // session-scoped client keeps the admin client's blast radius to the
  // profiles write only.
  await replaceGameInterests(supabase, userId, parsed.data.gameInterests)

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/onboarding/profile-completion-service.test.ts`
Expected: PASS

- [ ] **Step 5: Add the Server Action**

In `lib/onboarding/actions.ts`, add the import and a new exported action (after the existing `claimUsername` export):

```ts
import { parseOnboardingProfileFormData } from './profile-schema'
import { performCompleteProfileOnboarding, type CompleteProfileOnboardingErrorCode } from './profile-completion-service'

export type CompleteProfileOnboardingState = { errorCode?: CompleteProfileOnboardingErrorCode } | undefined

export async function completeProfileOnboarding(
  _prev: CompleteProfileOnboardingState,
  formData: FormData,
): Promise<CompleteProfileOnboardingState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/profile')

  const result = await performCompleteProfileOnboarding(supabase, createAdminClient(), user.id, parseOnboardingProfileFormData(formData))
  if (!result.ok) return { errorCode: result.errorCode }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
}
```

- [ ] **Step 6: Run the full onboarding test suite**

Run: `npx vitest run lib/onboarding/`
Expected: PASS (all files: `actions.test.ts`, `claim-username-service.test.ts`, `gate.test.ts`, `profile-schema.test.ts`, `profile-completion-service.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add lib/onboarding/profile-completion-service.ts lib/onboarding/profile-completion-service.test.ts lib/onboarding/actions.ts
git commit -m "feat(onboarding): add completeProfileOnboarding() service and Server Action"
```

---

## Task 8: `/onboarding/profile` route, form, and translations

**Files:**
- Create: `app/[locale]/(auth)/onboarding/profile/page.tsx`
- Create: `components/onboarding/OnboardingProfileForm.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `auth.meta.profile` and `auth.profileStep.{title,subtitle}`)

**Interfaces:**
- Consumes: `completeProfileOnboarding`/`CompleteProfileOnboardingState` (Task 7), `safeInternalPath` (existing), `listCountries` (Task 2). Reads `games(id, name, icon_url)` (all rows, active and inactive) and the user's existing `game_interest` rows via the session-scoped client (both public/own-row reads, no admin client needed — `games` has no RLS lockdown and `game_interest` already allows `select own`).
- Produces: nothing consumed elsewhere — this is a leaf UI route.

This task has no automated test — the repository has zero `.test.tsx` component tests (verified: `find . -iname '*.test.tsx'` returns none), and admin/onboarding page composition is conventionally verified by manual browser check per CLAUDE.md ("test the golden path... in a browser"). Step 5 below is that manual check.

- [ ] **Step 1: Add translations**

In `messages/en.json`, inside `auth.meta` (after the `"phone"` key, line 155):

```json
      "phone": "Verify your phone · SentinelX Esports",
      "profile": "Complete your profile · SentinelX Esports"
```

Inside `auth` (as a sibling of `phoneStep`, after line 222):

```json
    "profileStep": {
      "title": "Complete your profile",
      "subtitle": "Tell us where you play and which games you're into — we'll only reach out about tournaments you actually care about."
    },
```

Repeat both additions in `messages/fr.json` and `messages/pcm.json`, translated to match each file's existing tone for `phoneStep`/`meta.phone` (read the existing `phoneStep`/`meta.phone` entries in each file first, then write the `profile`/`profileStep` equivalents in the same voice — do not leave English placeholders in the non-English files).

- [ ] **Step 2: Write the server component route**

```tsx
// app/[locale]/(auth)/onboarding/profile/page.tsx
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/onboarding/safe-path'
import { OnboardingProfileForm } from '@/components/onboarding/OnboardingProfileForm'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('profile'), robots: { index: false, follow: false } }
}

export default async function OnboardingProfilePage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/profile')

  const { data: profile } = await supabase
    .from('profiles')
    .select('profile_completed_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.profile_completed_at) redirect(safeInternalPath(searchParams.next, '/dashboard'))

  const [{ data: games }, { data: existingInterest }] = await Promise.all([
    supabase.from('games').select('id, name, icon_url').order('name'),
    supabase.from('game_interest').select('game_id').eq('user_id', user.id),
  ])

  const t = await getTranslations('auth.profileStep')
  const next = safeInternalPath(searchParams.next, '')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <OnboardingProfileForm
        games={games ?? []}
        selectedGameIds={(existingInterest ?? []).map((row) => row.game_id)}
        next={next || undefined}
      />
    </div>
  )
}
```

- [ ] **Step 3: Write the client form component**

```tsx
// components/onboarding/OnboardingProfileForm.tsx
'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { completeProfileOnboarding, type CompleteProfileOnboardingState } from '@/lib/onboarding/actions'
import { listCountries } from '@/lib/phone/number'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Please fill in every field and pick at least one game.',
  invalid_whatsapp: 'Enter a valid WhatsApp number for the selected country.',
  save_failed: 'Could not save your profile. Please try again.',
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Saving…' : 'Continue'}
    </Button>
  )
}

export function OnboardingProfileForm({
  games,
  selectedGameIds,
  next,
}: {
  games: { id: string; name: string; icon_url: string | null }[]
  selectedGameIds: string[]
  next?: string
}) {
  const [state, formAction] = useFormState<CompleteProfileOnboardingState, FormData>(completeProfileOnboarding, undefined)
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedGameIds))
  const [consent, setConsent] = useState(false)
  const countries = listCountries()

  function toggleGame(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-1.5">
        <Label htmlFor="country">Country</Label>
        <select
          id="country"
          name="country"
          defaultValue=""
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="" disabled>
            Select your country
          </option>
          {countries.map((c) => (
            <option key={c.code} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="whatsapp">WhatsApp number</Label>
        <Input id="whatsapp" name="whatsapp" type="tel" placeholder="+2348012345678" required autoFocus />
      </div>

      <div className="space-y-1.5">
        <Label>Which games are you interested in?</Label>
        <div className="space-y-1.5 rounded-lg border border-slate-700 bg-slate-950 p-3">
          {games.map((game) => (
            <label key={game.id} className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                name="gameInterests"
                value={game.id}
                checked={selected.has(game.id)}
                onChange={() => toggleGame(game.id)}
                className="h-4 w-4 accent-violet-500"
              />
              {game.name}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-violet-500"
        />
        I agree to receive tournament updates on WhatsApp
      </label>
      {/* A bare unchecked checkbox omits itself from FormData — mirror the
          controlled state into a hidden input so "no" always arrives as the
          literal string 'false', distinguishable from "never answered". */}
      <input type="hidden" name="consentWhatsappUpdates" value={consent ? 'true' : 'false'} />

      {state?.errorCode && <p className="text-sm text-red-400">{ERROR_MESSAGES[state.errorCode]}</p>}
      <SubmitButton />
    </form>
  )
}
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS across the whole suite

- [ ] **Step 5: Manual browser verification**

Run the dev server (`npm run dev`), sign in as a test account whose `profile_completed_at` is `NULL` (any existing seeded account qualifies, since this migration starts everyone at `NULL`), navigate to `/dashboard`, and confirm:
- It redirects to `/onboarding/profile`.
- The country `<select>` has no default selection and lists real country names.
- Submitting with no games checked shows the `invalid_input` error, not a silent no-op.
- Submitting with a country/number mismatch (e.g. country "Nigeria", number a South African-shaped `0821234567`) shows `invalid_whatsapp`.
- A valid submission redirects to `/dashboard` and does not re-trigger the gate on the next visit.
- If a game was already "Notify Me"-clicked pre-onboarding (via a Coming Soon page), it shows pre-checked here.

- [ ] **Step 6: Commit**

```bash
git add app/\[locale\]/\(auth\)/onboarding/profile/page.tsx components/onboarding/OnboardingProfileForm.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(onboarding): add the /onboarding/profile route and form"
```

---

## Task 9: Extend the Settings profile schema (validation fix)

**Files:**
- Modify: `lib/profile/schema.ts` (entire file)
- Create: `lib/profile/schema.test.ts`

**Interfaces:**
- Consumes: `parsePlayerPhone` from `lib/phone/number.ts` (existing).
- Produces: extended `profileEditSchema` (now with cross-field `whatsapp`+`country` validation via `superRefine`, plus optional `gameInterests`/`consentWhatsappUpdates`) — consumed by Task 10 (`performUpdateProfile`), Task 11 (the Settings Server Action), and already-wired-automatically into the mobile `updateProfileEndpoint` body (`lib/mobile-api/endpoints/me.ts:81`, no change needed there — it does `profileEditSchema.extend(...)`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { profileEditSchema } from './schema'

const base = { displayName: 'Ada', username: '', whatsapp: '', country: '', bio: '' }

describe('profileEditSchema', () => {
  it('accepts a blank whatsapp with any country (nothing to cross-validate)', () => {
    expect(profileEditSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a whatsapp number valid for the given country', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: 'Nigeria' }).success).toBe(true)
  })

  it('rejects a whatsapp number that is the wrong shape for the given country', () => {
    const result = profileEditSchema.safeParse({ ...base, whatsapp: '0821234567', country: 'Nigeria' })
    expect(result.success).toBe(false)
  })

  it('resolves a legacy free-text country via the existing alias table', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: 'Nigerian' }).success).toBe(true)
  })

  it('defaults to Nigeria when country is blank', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: '' }).success).toBe(true)
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '0821234567', country: '' }).success).toBe(false)
  })

  it('accepts gameInterests and consentWhatsappUpdates when provided', () => {
    const result = profileEditSchema.safeParse({
      ...base,
      gameInterests: ['11111111-1111-1111-1111-111111111111'],
      consentWhatsappUpdates: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts the omission of gameInterests and consentWhatsappUpdates (leave-unchanged semantics)', () => {
    const result = profileEditSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.gameInterests).toBeUndefined()
      expect(result.data.consentWhatsappUpdates).toBeUndefined()
    }
  })

  it('rejects a non-uuid entry in gameInterests', () => {
    expect(profileEditSchema.safeParse({ ...base, gameInterests: ['not-a-uuid'] }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/profile/schema.test.ts`
Expected: FAIL — the current schema validates `whatsapp` with a standalone regex that accepts `0821234567` regardless of country, and has no `gameInterests`/`consentWhatsappUpdates` fields.

- [ ] **Step 3: Rewrite the schema**

```ts
// lib/profile/schema.ts
import { z } from 'zod'
import { usernameSchema } from '@/lib/auth/schema'
import { parsePlayerPhone } from '@/lib/phone/number'

export const profileEditSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
    username: z.union([z.literal(''), usernameSchema]),
    whatsapp: z.union([z.literal(''), z.string().trim().max(30)]),
    country: z.union([z.literal(''), z.string().trim().max(60, 'Country is too long')]),
    bio: z.union([z.literal(''), z.string().trim().max(280, 'Bio must be 280 characters or fewer')]),
    gameInterests: z.array(z.string().uuid()).optional(), // omitted = leave unchanged
    consentWhatsappUpdates: z.boolean().optional(), // omitted = leave unchanged
  })
  .superRefine((val, ctx) => {
    if (val.whatsapp && !parsePlayerPhone(val.whatsapp, { country: val.country })) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid WhatsApp number for the selected country' })
    }
  })

export type ProfileEditInput = z.infer<typeof profileEditSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/profile/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/profile/schema.ts lib/profile/schema.test.ts
git commit -m "fix(profile): validate whatsapp against the selected country's numbering plan"
```

---

## Task 10: Extend `performUpdateProfile()` to write consent + game interests

**Files:**
- Modify: `lib/profile/update-profile-service.ts:14-53`
- Modify: `lib/profile/update-profile-service.test.ts` (extend, don't replace — the existing 5 tests must keep passing unchanged since they exercise `baseInput` with both new fields absent)

**Interfaces:**
- Consumes: `replaceGameInterests` (Task 3), extended `ProfileEditInput` (Task 9).
- Produces: `performUpdateProfile` now also writes `consent_whatsapp_updates` (only when provided) and calls `replaceGameInterests` (only when `gameInterests` provided) — consumed by Task 11 (Settings action) and already-consumed by `updateProfileEndpoint` (`lib/mobile-api/endpoints/me.ts:102`, no change needed there, same call signature).

- [ ] **Step 1: Add the failing tests (append to the existing file, don't replace it)**

Append to `lib/profile/update-profile-service.test.ts`:

```ts
describe('performUpdateProfile — game interests and consent', () => {
  function fakeSupabaseWithGameInterest() {
    const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const insert = vi.fn().mockResolvedValue({ error: null })
    return {
      supabase: {
        from: (table: string) => {
          if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: 'x', username_changed_at: null } }) }) }) }
          if (table === 'game_interest') return { delete: del, insert }
          throw new Error(`unexpected table ${table}`)
        },
      } as never,
      del,
      insert,
    }
  }

  it('writes consent_whatsapp_updates when provided', async () => {
    const { admin, update } = fakeAdmin()
    const { supabase } = fakeSupabaseWithGameInterest()
    await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, consentWhatsappUpdates: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consent_whatsapp_updates: true }))
  })

  it('omits consent_whatsapp_updates from the patch entirely when not provided', async () => {
    const { admin, update } = fakeAdmin()
    await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', baseInput)
    const patch = update.mock.calls[0][0]
    expect(patch).not.toHaveProperty('consent_whatsapp_updates')
  })

  it('replaces game interests when gameInterests is provided', async () => {
    const { admin } = fakeAdmin()
    const { supabase, del, insert } = fakeSupabaseWithGameInterest()
    const result = await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, gameInterests: ['11111111-1111-1111-1111-111111111111'] })
    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith([{ user_id: 'u1', game_id: '11111111-1111-1111-1111-111111111111' }])
  })

  it('does not touch game_interest when gameInterests is omitted', async () => {
    const { admin } = fakeAdmin()
    // fakeSupabase's from() ignores the table name — if replaceGameInterests
    // were called it would try .delete() on this stub and throw, since it
    // only implements .select(). No throw = it was correctly skipped.
    const result = await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', baseInput)
    expect(result).toEqual({ ok: true })
  })

  it('clears all game interests when gameInterests is an empty array (distinct from omitted)', async () => {
    const { admin } = fakeAdmin()
    const { supabase, del, insert } = fakeSupabaseWithGameInterest()
    await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, gameInterests: [] })
    expect(del).toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/profile/update-profile-service.test.ts`
Expected: The 5 original tests PASS unchanged; the 5 new tests FAIL (current code ignores `consentWhatsappUpdates`/`gameInterests` entirely and never calls `replaceGameInterests`).

- [ ] **Step 3: Extend the implementation**

```ts
// lib/profile/update-profile-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ProfileEditInput } from './schema'
import { replaceGameInterests } from '@/lib/games/game-interest-service'

type Admin = ReturnType<typeof createAdminClient>

export type UpdateProfileErrorCode = 'username_taken' | 'username_locked' | 'save_failed'
export type UpdateProfileResult = { ok: true } | { ok: false; errorCode: UpdateProfileErrorCode }

// Extracted from lib/profile/actions.ts's updateProfile() — the Server
// Action and PATCH /me/profile both call this. No locale field: the real
// action never had one (spec S5.1's correction to the master catalogue).
export async function performUpdateProfile(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  input: ProfileEditInput & { avatarUrl?: string },
): Promise<UpdateProfileResult> {
  const avatarPatch = input.avatarUrl ? { avatar_url: input.avatarUrl } : {}

  let usernamePatch: { username?: string; username_changed_at?: string } = {}
  if (input.username) {
    const { data: current } = await supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('id', userId)
      .maybeSingle()
    if (current && current.username !== input.username) {
      if (current.username_changed_at) return { ok: false, errorCode: 'username_locked' }
      usernamePatch = { username: input.username, username_changed_at: new Date().toISOString() }
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({
      display_name: input.displayName,
      whatsapp_number: input.whatsapp || null,
      country: input.country || null,
      bio: input.bio || null,
      ...(input.consentWhatsappUpdates !== undefined ? { consent_whatsapp_updates: input.consentWhatsappUpdates } : {}),
      ...avatarPatch,
      ...usernamePatch,
    })
    .eq('id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, errorCode: 'username_taken' }
    console.error('performUpdateProfile: update failed', error)
    return { ok: false, errorCode: 'save_failed' }
  }

  if (input.gameInterests !== undefined) {
    await replaceGameInterests(supabase, userId, input.gameInterests)
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/profile/update-profile-service.test.ts`
Expected: PASS (all 10 tests — the original 5 plus the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/profile/update-profile-service.ts lib/profile/update-profile-service.test.ts
git commit -m "feat(profile): write consent and game interests through performUpdateProfile"
```

---

## Task 11: Extend the Settings Server Action's FormData mapping

**Files:**
- Modify: `lib/profile/actions.ts:27-39`
- Create: `lib/profile/actions.test.ts`

**Interfaces:**
- Consumes: `profileEditSchema` (Task 9), `performUpdateProfile` (Task 10).
- Produces: nothing new consumed elsewhere — this closes the loop for the web Settings path. Per `[[feedback_test_the_formdata_path]]`, this task's test must build a real `FormData` object and call a small extracted pure function, not just assert on the Zod schema — the whole point is catching a field the hand-written mapping forgot to read.

- [ ] **Step 1: Extract a testable FormData→input mapper and write its failing test**

Create `lib/profile/actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseProfileEditFormData } from './actions'

describe('parseProfileEditFormData', () => {
  it('reads every field including repeated gameInterests entries and the consent hidden input', () => {
    const fd = new FormData()
    fd.set('displayName', 'Ada')
    fd.set('username', '')
    fd.set('whatsapp', '08012345678')
    fd.set('country', 'Nigeria')
    fd.set('bio', 'hi')
    fd.set('consentWhatsappUpdates', 'true')
    fd.append('gameInterests', '11111111-1111-1111-1111-111111111111')
    fd.append('gameInterests', '22222222-2222-2222-2222-222222222222')

    expect(parseProfileEditFormData(fd)).toEqual({
      displayName: 'Ada',
      username: '',
      whatsapp: '08012345678',
      country: 'Nigeria',
      bio: 'hi',
      consentWhatsappUpdates: true,
      gameInterests: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    })
  })

  it('omits consentWhatsappUpdates and gameInterests from the result when the form sends neither key at all (leave-unchanged path)', () => {
    const fd = new FormData()
    fd.set('displayName', 'Ada')
    fd.set('username', '')
    fd.set('whatsapp', '')
    fd.set('country', '')
    fd.set('bio', '')
    expect(parseProfileEditFormData(fd)).toEqual({
      displayName: 'Ada',
      username: '',
      whatsapp: '',
      country: '',
      bio: '',
    })
  })

  it('reads consentWhatsappUpdates as false when the hidden input is present but "false"', () => {
    const fd = new FormData()
    fd.set('displayName', 'Ada')
    fd.set('username', '')
    fd.set('whatsapp', '')
    fd.set('country', '')
    fd.set('bio', '')
    fd.set('consentWhatsappUpdates', 'false')
    expect(parseProfileEditFormData(fd).consentWhatsappUpdates).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/profile/actions.test.ts`
Expected: FAIL (`parseProfileEditFormData` isn't exported yet — `lib/profile/actions.ts` has a `'use server'` directive at the top, so every other export must stay an async function; this one is a plain sync helper, so it needs to live in a way that doesn't violate that. See Step 3.)

- [ ] **Step 3: Extract the mapper into `lib/profile/form-data.ts` and re-export nothing extra from `actions.ts`**

A file with `'use server'` at the top can only export async functions — a plain sync helper like `parseProfileEditFormData` can't live in `lib/profile/actions.ts` directly. Create `lib/profile/form-data.ts`:

```ts
// lib/profile/form-data.ts
// Kept out of actions.ts because that file is 'use server' — every export
// there must be an async function. gameInterests arrives as repeated
// FormData entries under one key (one per checked checklist item);
// consentWhatsappUpdates/gameInterests are only included in the result when
// the form actually sent the corresponding key, so profileEditSchema's
// "omitted = leave unchanged" semantics are preserved end to end.
export function parseProfileEditFormData(formData: FormData) {
  const result: {
    displayName: string
    username: string
    whatsapp: string
    country: string
    bio: string
    consentWhatsappUpdates?: boolean
    gameInterests?: string[]
  } = {
    displayName: String(formData.get('displayName') ?? ''),
    username: String(formData.get('username') ?? ''),
    whatsapp: String(formData.get('whatsapp') ?? ''),
    country: String(formData.get('country') ?? ''),
    bio: String(formData.get('bio') ?? ''),
  }
  const consent = formData.get('consentWhatsappUpdates')
  if (consent !== null) result.consentWhatsappUpdates = consent === 'true'
  if (formData.has('gameInterests')) result.gameInterests = formData.getAll('gameInterests').map(String)
  return result
}
```

Update the test file's import to `from './form-data'` instead of `from './actions'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/profile/actions.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the mapper into the Server Action**

In `lib/profile/actions.ts`, replace the import block and the parse call:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { profileEditSchema } from './schema'
import { parseProfileEditFormData } from './form-data'
import { performUpdateProfile, type UpdateProfileErrorCode } from './update-profile-service'
```

```ts
  const parsed = profileEditSchema.safeParse(parseProfileEditFormData(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
```

(This replaces the current inline object literal at lines 27-33 with the extracted mapper call — everything else in `updateProfile()` stays the same.)

- [ ] **Step 6: Run the full profile test suite**

Run: `npx vitest run lib/profile/`
Expected: PASS (`schema.test.ts`, `update-profile-service.test.ts`, `actions.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add lib/profile/form-data.ts lib/profile/actions.ts lib/profile/actions.test.ts
git commit -m "feat(profile): wire gameInterests/consent through the Settings FormData path"
```

---

## Task 12: Settings UI — game-interest checklist and consent checkbox

**Files:**
- Modify: `components/settings/ProfileForm.tsx` (entire file)
- Modify: `app/[locale]/dashboard/settings/page.tsx:38-52,82-94`

**Interfaces:**
- Consumes: `updateProfile`/`ProfileEditState` (existing, now accepts the two new FormData keys per Task 11), no new exports.
- Produces: nothing new consumed elsewhere. No automated test (component test convention absent from this repo, per Task 8's note) — verified manually in Step 3.

- [ ] **Step 1: Extend `ProfileForm`**

Replace `components/settings/ProfileForm.tsx` in full:

```tsx
'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { updateProfile, type ProfileEditState } from '@/lib/profile/actions'
import { compressImageToWebp } from '@/lib/avatars/compress'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

function SaveButton({ uploading }: { uploading: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={uploading || pending}
      className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
  )
}

export interface SettingsProfile {
  displayName: string | null
  username: string
  usernameChangedAt: string | null
  avatarUrl: string | null
  membershipTier: MembershipTier
  frameUrl?: string
  whatsapp: string | null
  country: string | null
  bio: string | null
  consentWhatsappUpdates: boolean
  gameInterestIds: string[]
}

export interface SettingsGame {
  id: string
  name: string
  iconUrl: string | null
}

export function ProfileForm({ profile, games }: { profile: SettingsProfile; games: SettingsGame[] }) {
  const [state, formAction] = useFormState<ProfileEditState, FormData>(updateProfile, undefined)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const usernameLocked = !!profile.usernameChangedAt
  const [usernameValue, setUsernameValue] = useState(profile.username)
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set(profile.gameInterestIds))
  const [consent, setConsent] = useState(profile.consentWhatsappUpdates)

  function toggleGame(id: string) {
    setSelectedGames((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setUploadError('Please log in.')
      return
    }
    try {
      const compressed = await compressImageToWebp(file)
      const path = `${user.id}/${crypto.randomUUID()}.webp`
      const { error } = await supabase.storage.from('avatars').upload(path, compressed, {
        upsert: false,
        contentType: 'image/webp',
      })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
    } catch {
      setUploadError('Avatar upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-white">Profile</h2>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="avatarUrl" value={avatarUrl ?? ''} />
        <div className="flex items-center gap-4">
          <HexAvatar src={avatarUrl} username={profile.displayName ?? profile.username} tier={profile.membershipTier} size="lg" frameUrl={profile.frameUrl} />
          <label className="cursor-pointer text-sm font-semibold text-sx-purple-text hover:text-sx-purple-light">
            {uploading ? 'Uploading…' : 'Upload new photo'}
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" disabled={uploading} />
          </label>
        </div>
        <p className="text-xs text-sx-gray">Supported: JPG, PNG · Compressed to 400×400</p>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

        <Field label="Display Name" name="displayName" defaultValue={profile.displayName ?? ''} required />

        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium text-sx-gray">Username</label>
          {usernameLocked ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-gray">
              🔒 @{profile.username} — Contact support to change username.
            </p>
          ) : (
            <>
              <input
                id="username"
                name="username"
                type="text"
                value={usernameValue}
                onChange={(e) => setUsernameValue(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sx-purple focus:outline-none"
              />
              <p className="text-xs text-amber-400">⚠ Username can only be changed once.</p>
            </>
          )}
        </div>

        <Field label="Bio" name="bio" defaultValue={profile.bio ?? ''} textarea maxLength={280} />
        <Field label="Country" name="country" defaultValue={profile.country ?? ''} />
        <Field label="WhatsApp" name="whatsapp" defaultValue={profile.whatsapp ?? ''} type="tel" placeholder="+2348012345678" />

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-sx-gray">Game interests</label>
          <div className="space-y-1.5 rounded-lg border border-slate-700 bg-slate-950 p-3">
            {games.map((game) => (
              <label key={game.id} className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  name="gameInterests"
                  value={game.id}
                  checked={selectedGames.has(game.id)}
                  onChange={() => toggleGame(game.id)}
                  className="h-4 w-4 accent-sx-purple"
                />
                {game.name}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-sx-gray">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-sx-purple"
          />
          I agree to receive tournament updates on WhatsApp
        </label>
        <input type="hidden" name="consentWhatsappUpdates" value={consent ? 'true' : 'false'} />

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Profile updated.</p>}
        <SaveButton uploading={uploading} />
      </form>
    </section>
  )
}

function Field({
  label, name, defaultValue, required, textarea, maxLength, type = 'text', placeholder,
}: {
  label: string; name: string; defaultValue: string; required?: boolean
  textarea?: boolean; maxLength?: number; type?: string; placeholder?: string
}) {
  const cls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-sx-purple focus:outline-none'
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-sx-gray">{label}</label>
      {textarea ? (
        <textarea id={name} name={name} rows={3} maxLength={maxLength} defaultValue={defaultValue} className={cls} />
      ) : (
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className={cls} />
      )}
    </div>
  )
}
```

Note: submitting this form always sends `gameInterests` (possibly `[]`) and `consentWhatsappUpdates` (`'true'`/`'false'`) because both are always rendered — this is intentional per the spec (the checklist "represents current interest, not a click history"), and differs from a mobile client's PATCH which may genuinely omit either key.

- [ ] **Step 2: Wire the new data into the Settings page**

In `app/[locale]/dashboard/settings/page.tsx`, extend the `profiles` select (line 42) to include `consent_whatsapp_updates`:

```ts
      .select(
        'display_name, username, avatar_url, membership_tier, whatsapp_number, country, bio, kyc_verified, username_changed_at, notification_prefs, deletion_requested_at, equipped_avatar_border, consent_whatsapp_updates',
      )
```

Add two more parallel queries alongside the existing `Promise.all` (lines 38-52) — extend the destructuring and the array:

```ts
  const [{ data: row }, { data: kyc }, { count: fcmTokenCount }, { data: games }, { data: gameInterestRows }] = await Promise.all([
    createAdminClient()
      .from('profiles')
      .select(
        'display_name, username, avatar_url, membership_tier, whatsapp_number, country, bio, kyc_verified, username_changed_at, notification_prefs, deletion_requested_at, equipped_avatar_border, consent_whatsapp_updates',
      )
      .eq('id', user.id)
      .maybeSingle(),
    createAdminClient().from('player_kyc').select('kyc_status').eq('player_id', user.id).maybeSingle(),
    supabase.from('fcm_tokens').select('id', { count: 'exact', head: true }).eq('player_id', user.id),
    supabase.from('games').select('id, name, icon_url').order('name'),
    supabase.from('game_interest').select('game_id').eq('user_id', user.id),
  ])
```

Update the `ProfileForm` usage (lines 82-94) to pass the two new props:

```tsx
        <ProfileForm
          profile={{
            displayName: row?.display_name ?? null,
            username: row?.username ?? '',
            usernameChangedAt: row?.username_changed_at ?? null,
            avatarUrl: row?.avatar_url ?? null,
            membershipTier: (row?.membership_tier ?? 'recruit') as MembershipTier,
            frameUrl: frameUrlFor(row?.equipped_avatar_border),
            whatsapp: row?.whatsapp_number ?? null,
            country: row?.country ?? null,
            bio: row?.bio ?? null,
            consentWhatsappUpdates: row?.consent_whatsapp_updates ?? false,
            gameInterestIds: (gameInterestRows ?? []).map((r) => r.game_id),
          }}
          games={(games ?? []).map((g) => ({ id: g.id, name: g.name, iconUrl: g.icon_url }))}
        />
```

- [ ] **Step 3: Manual browser verification**

Run the dev server, sign in, go to `/dashboard/settings`, confirm: the game-interest checklist shows currently-interested games pre-checked, the consent checkbox reflects the stored value, checking/unchecking games and saving persists across a page reload, and unchecking the consent box and saving actually flips `consent_whatsapp_updates` to `false` (not left at whatever it was).

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/settings/ProfileForm.tsx app/\[locale\]/dashboard/settings/page.tsx
git commit -m "feat(settings): add game-interest checklist and WhatsApp consent checkbox"
```

---

## Task 13: Mobile API — extend `/me` response, regenerate OpenAPI

**Files:**
- Modify: `lib/mobile-api/endpoints/me.ts` (entire file)
- Modify: `lib/mobile-api/endpoints/me.test.ts` (entire file)
- Modify: `openapi/mobile-v1.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing new (uses `ctx.admin`, `ctx.userClient`, both already in `MobileCtx` — verify by reading `lib/mobile-api/auth.ts` if the exact field names differ from what's used here; they are used as-is already at `me.ts:72,102`).
- Produces: `toMeResponse` now takes a third argument `gameInterestIds: string[]`; the `/me` response body gains `profile.consentWhatsappUpdates`/`profile.gameInterests`. `updateProfileEndpoint`'s body/behavior is unchanged in this task (Task 10/11 already wired the underlying service) — only the response side changes here.

- [ ] **Step 1: Update the failing test**

Replace `lib/mobile-api/endpoints/me.test.ts` in full:

```ts
import { describe, it, expect } from 'vitest'
import { toMeResponse, updateProfileErrorMessage } from './me'

const ctx = { userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false } as never

describe('toMeResponse', () => {
  it('maps the profile row to camelCase, carries the role flags the app needs to show Admin, and includes consent + game interests', () => {
    const res = toMeResponse(
      ctx,
      {
        username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: '0803', country: 'NG',
        locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
        consent_whatsapp_updates: true,
      },
      ['11111111-1111-1111-1111-111111111111'],
    )
    expect(res).toEqual({
      id: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false,
      profile: {
        username: 'ada', displayName: 'Ada', avatarUrl: null, whatsappNumber: '0803', country: 'NG',
        locale: 'en', membershipTier: 'guardian', kycVerified: false, deletionRequestedAt: null,
        consentWhatsappUpdates: true, gameInterests: ['11111111-1111-1111-1111-111111111111'],
      },
    })
  })

  it('returns a null profile when the row does not exist yet', () => {
    expect(toMeResponse(ctx, null, []).profile).toBeNull()
  })

  it('defaults gameInterests to an empty array when none are passed', () => {
    const res = toMeResponse(
      ctx,
      {
        username: 'ada', display_name: null, avatar_url: null, whatsapp_number: null, country: null,
        locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
        consent_whatsapp_updates: false,
      },
      [],
    )
    expect(res.profile?.gameInterests).toEqual([])
  })
})

describe('updateProfileErrorMessage', () => {
  it('maps each UpdateProfileErrorCode to a player-facing message', () => {
    expect(updateProfileErrorMessage('username_taken')).toBe('That username is already taken.')
    expect(updateProfileErrorMessage('username_locked')).toBe('Username has already been changed once.')
    expect(updateProfileErrorMessage('save_failed')).toBe('Could not save your profile. Please try again.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts`
Expected: FAIL — `toMeResponse` doesn't accept a third argument yet and the response shape doesn't include the new fields.

- [ ] **Step 3: Extend the endpoint**

Replace `lib/mobile-api/endpoints/me.ts` in full:

```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'
import { profileEditSchema } from '@/lib/profile/schema'
import { performUpdateProfile, type UpdateProfileErrorCode } from '@/lib/profile/update-profile-service'
import { ApiError } from '../errors'

const meResponse = z.object({
  id: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  isStaff: z.boolean(),
  isAdmin: z.boolean(),
  profile: z
    .object({
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      whatsappNumber: z.string().nullable(),
      country: z.string().nullable(),
      locale: z.string().nullable(),
      membershipTier: z.string().nullable(),
      kycVerified: z.boolean(),
      deletionRequestedAt: z.string().nullable(),
      consentWhatsappUpdates: z.boolean(),
      gameInterests: z.array(z.string()),
    })
    .nullable(),
})

interface ProfileRow {
  username: string | null
  display_name: string | null
  avatar_url: string | null
  whatsapp_number: string | null
  country: string | null
  locale: string | null
  membership_tier: string | null
  kyc_verified: boolean
  deletion_requested_at: string | null
  consent_whatsapp_updates: boolean
}

export function toMeResponse(
  ctx: Pick<MobileCtx, 'userId' | 'email' | 'roles' | 'isStaff' | 'isAdmin'>,
  row: ProfileRow | null,
  gameInterestIds: string[],
) {
  return {
    id: ctx.userId,
    email: ctx.email,
    roles: ctx.roles as string[],
    isStaff: ctx.isStaff,
    isAdmin: ctx.isAdmin,
    profile: row && {
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      whatsappNumber: row.whatsapp_number,
      country: row.country,
      locale: row.locale,
      membershipTier: row.membership_tier,
      kycVerified: row.kyc_verified,
      deletionRequestedAt: row.deletion_requested_at,
      consentWhatsappUpdates: row.consent_whatsapp_updates,
      gameInterests: gameInterestIds,
    },
  }
}

export const meEndpoint = defineEndpoint({
  operationId: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'The signed-in user, their roles (drives the role-aware Admin section) and own profile.',
  auth: 'user',
  response: meResponse,
  handler: async ({ ctx }) => {
    // Own row only, id from the verified token. Service role because whatsapp_number and
    // deletion_requested_at are private columns (plan 2026-09-18-mobile-phase0a-security-hardening.md).
    const [{ data }, { data: gameInterestRows }] = await Promise.all([
      ctx.admin
        .from('profiles')
        .select('username, display_name, avatar_url, whatsapp_number, country, locale, membership_tier, kyc_verified, deletion_requested_at, consent_whatsapp_updates')
        .eq('id', ctx.userId)
        .maybeSingle(),
      ctx.admin.from('game_interest').select('game_id').eq('user_id', ctx.userId),
    ])
    return toMeResponse(ctx, data, (gameInterestRows ?? []).map((r) => r.game_id))
  },
})

const updateProfileBody = profileEditSchema.extend({ avatarUrl: z.string().url().optional() })
const updateProfileResponse = z.object({ ok: z.literal(true) })

export function updateProfileErrorMessage(code: UpdateProfileErrorCode): string {
  const messages: Record<UpdateProfileErrorCode, string> = {
    username_taken: 'That username is already taken.',
    username_locked: 'Username has already been changed once.',
    save_failed: 'Could not save your profile. Please try again.',
  }
  return messages[code]
}

export const updateProfileEndpoint = defineEndpoint({
  operationId: 'patchMeProfile',
  method: 'PATCH',
  path: '/me/profile',
  summary: "Update the signed-in player's own profile (display name, bio, country, one-time username change, avatar, game interests, WhatsApp outreach consent).",
  auth: 'user',
  body: updateProfileBody,
  response: updateProfileResponse,
  handler: async ({ ctx, body }) => {
    const result = await performUpdateProfile(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, result.errorCode, updateProfileErrorMessage(result.errorCode))
    return { ok: true as const }
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts`
Expected: PASS

- [ ] **Step 5: Regenerate the OpenAPI snapshot**

Run: `npm run openapi`
This runs `vitest run lib/mobile-api/openapi.test.ts -u`, updating `openapi/mobile-v1.json` in place.

- [ ] **Step 6: Run the full mobile-api test suite**

Run: `npx vitest run lib/mobile-api/`
Expected: PASS, including `openapi.test.ts`'s "is up to date" check

- [ ] **Step 7: Commit**

```bash
git add lib/mobile-api/endpoints/me.ts lib/mobile-api/endpoints/me.test.ts openapi/mobile-v1.json
git commit -m "feat(mobile-api): expose consentWhatsappUpdates/gameInterests on GET /me"
```

---

## Task 14: Admin segment/export helpers (grouping, filtering, CSV)

**Files:**
- Create: `lib/games/game-interest-segment.ts`
- Test: `lib/games/game-interest-segment.test.ts`

**Interfaces:**
- Produces: `groupGameInterestRows(rows): SegmentPlayer[]`, `buildContactCsv(players): string`, `buildContactNumbers(players): string[]` — consumed by Task 15's admin page and export Server Action. Defined as pure functions specifically so the spec's testing checklist item ("filter-by-game, filter-by-country, consent=false rows excluded, CSV/copy export shape") has a real test surface — the admin page itself (Task 15) is, like every other admin page in this repo, not directly unit-tested.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { groupGameInterestRows, buildContactCsv, buildContactNumbers } from './game-interest-segment'

const raw = [
  { user_id: 'u1', profiles: { id: 'u1', username: 'ada', display_name: 'Ada', country: 'Nigeria', whatsapp_number: '+2348012345678', consent_whatsapp_updates: true }, games: { name: 'EA FC Mobile' } },
  { user_id: 'u1', profiles: { id: 'u1', username: 'ada', display_name: 'Ada', country: 'Nigeria', whatsapp_number: '+2348012345678', consent_whatsapp_updates: true }, games: { name: 'eFootball' } },
  { user_id: 'u2', profiles: { id: 'u2', username: 'bola', display_name: 'Bola', country: 'Ghana', whatsapp_number: '+233244123456', consent_whatsapp_updates: true }, games: { name: 'EA FC Mobile' } },
]

describe('groupGameInterestRows', () => {
  it('collapses a player interested in multiple games into one row with a combined game label', () => {
    const grouped = groupGameInterestRows(raw)
    expect(grouped).toHaveLength(2)
    const ada = grouped.find((p) => p.id === 'u1')
    expect(ada?.games).toBe('EA FC Mobile, eFootball')
  })

  it('keeps each distinct player as a separate row', () => {
    const grouped = groupGameInterestRows(raw)
    expect(grouped.map((p) => p.id).sort()).toEqual(['u1', 'u2'])
  })

  it('returns an empty list for an empty input', () => {
    expect(groupGameInterestRows([])).toEqual([])
  })
})

describe('buildContactNumbers', () => {
  it('returns each grouped player\'s E.164 number once', () => {
    const grouped = groupGameInterestRows(raw)
    expect(buildContactNumbers(grouped).sort()).toEqual(['+2348012345678', '+233244123456'])
  })
})

describe('buildContactCsv', () => {
  it('produces a header row plus one row per player with name, country, number, and combined games', () => {
    const grouped = groupGameInterestRows(raw)
    const csv = buildContactCsv(grouped)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,country,whatsapp_number,game_interests')
    expect(lines).toContain('Ada,Nigeria,+2348012345678,"EA FC Mobile, eFootball"')
    expect(lines).toContain('Bola,Ghana,+233244123456,EA FC Mobile')
  })

  it('falls back to username when display_name is null', () => {
    const withNullName = [{ ...raw[2], profiles: { ...raw[2].profiles, display_name: null } }]
    const grouped = groupGameInterestRows(withNullName)
    expect(buildContactCsv(grouped)).toContain('bola,Ghana,+233244123456,EA FC Mobile')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/games/game-interest-segment.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement the helpers**

```ts
// lib/games/game-interest-segment.ts

export interface RawGameInterestRow {
  user_id: string
  profiles: {
    id: string
    username: string | null
    display_name: string | null
    country: string | null
    whatsapp_number: string | null
    consent_whatsapp_updates: boolean
  }
  games: { name: string }
}

export interface SegmentPlayer {
  id: string
  name: string
  country: string | null
  whatsappNumber: string | null
  games: string
}

// One row per distinct player, combining every game they matched the filter
// on into a single comma-joined label — same in-memory-group-after-join
// approach lib/admin/search.ts's matchesPlayerQuery neighbors use elsewhere
// in this codebase rather than a DB-side aggregate.
export function groupGameInterestRows(rows: RawGameInterestRow[]): SegmentPlayer[] {
  const byId = new Map<string, SegmentPlayer>()
  for (const row of rows) {
    const existing = byId.get(row.user_id)
    if (existing) {
      existing.games = `${existing.games}, ${row.games.name}`
      continue
    }
    byId.set(row.user_id, {
      id: row.profiles.id,
      name: row.profiles.display_name ?? row.profiles.username ?? row.profiles.id,
      country: row.profiles.country,
      whatsappNumber: row.profiles.whatsapp_number,
      games: row.games.name,
    })
  }
  return Array.from(byId.values())
}

export function buildContactNumbers(players: SegmentPlayer[]): string[] {
  return players.map((p) => p.whatsappNumber).filter((n): n is string => !!n)
}

function csvField(value: string): string {
  return value.includes(',') ? `"${value}"` : value
}

export function buildContactCsv(players: SegmentPlayer[]): string {
  const header = 'name,country,whatsapp_number,game_interests'
  const rows = players.map(
    (p) => `${csvField(p.name)},${p.country ?? ''},${p.whatsappNumber ?? ''},${csvField(p.games)}`,
  )
  return [header, ...rows].join('\n') + '\n'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/games/game-interest-segment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/games/game-interest-segment.ts lib/games/game-interest-segment.test.ts
git commit -m "feat(admin): add game-interest grouping/CSV/copy helpers"
```

---

## Task 15: Admin "Game Interest" segment page

**Files:**
- Modify: `lib/admin/nav.ts:16` (insert nav entry after "Players")
- Create: `app/[locale]/admin/players/game-interest/page.tsx`
- Create: `lib/games/game-interest-admin-actions.ts`
- Create: `components/admin/GameInterestExportButtons.tsx`

**Interfaces:**
- Consumes: `groupGameInterestRows`/`buildContactCsv`/`buildContactNumbers` (Task 14), `requireStaff` (existing, `lib/admin/auth.ts`), `createAdminClient` (existing).
- Produces: nothing consumed elsewhere — final leaf of the pipeline. No automated test for the page/action themselves, consistent with the rest of `app/[locale]/admin/**` in this repo (verified: no `admin/**/page.tsx` has a sibling test file) — verified manually in Step 4.

- [ ] **Step 1: Add the nav entry**

In `lib/admin/nav.ts`, after line 16 (`{ label: 'Players', href: '/admin/players', adminOnly: false },`):

```ts
  { label: 'Game Interest', href: '/admin/players/game-interest', adminOnly: false },
```

Run: `npx vitest run lib/admin/nav.test.ts` — Expected: PASS (this file only tests `visibleNav`/`isAdminNavActive` logic against arbitrary fixture arrays, not the real `ADMIN_NAV` list, so adding an entry doesn't need a matching test change; confirm this by reading the test file before editing if uncertain).

- [ ] **Step 2: Write the export Server Action**

Placed in `lib/`, not colocated under `app/[locale]/...` — matching the existing precedent of `components/admin/RecomputeButton.tsx` importing `recomputeAllAction` from `lib/scoring/admin-actions.ts` and invoking it directly from an `onClick` handler (a `'use server'` action can be called as a plain async function from a Client Component, no `<form>` required).

```ts
// lib/games/game-interest-admin-actions.ts
'use server'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { groupGameInterestRows, buildContactCsv, buildContactNumbers, type RawGameInterestRow } from '@/lib/games/game-interest-segment'

async function fetchSegment(game?: string, country?: string): Promise<RawGameInterestRow[]> {
  const admin = createAdminClient()
  let query = admin
    .from('game_interest')
    .select('user_id, profiles!inner(id, username, display_name, country, whatsapp_number, consent_whatsapp_updates), games!inner(name)')
    .eq('profiles.consent_whatsapp_updates', true)
  if (game) query = query.eq('game_id', game)
  if (country) query = query.eq('profiles.country', country)
  const { data } = await query
  return (data ?? []) as unknown as RawGameInterestRow[]
}

export async function exportContactNumbers(game?: string, country?: string): Promise<{ numbers: string[] }> {
  await requireStaff()
  const rows = await fetchSegment(game, country)
  return { numbers: buildContactNumbers(groupGameInterestRows(rows)) }
}

export async function exportContactCsv(game?: string, country?: string): Promise<{ csv: string }> {
  await requireStaff()
  const rows = await fetchSegment(game, country)
  return { csv: buildContactCsv(groupGameInterestRows(rows)) }
}
```

- [ ] **Step 3: Write the page and export buttons**

```tsx
// app/[locale]/admin/players/game-interest/page.tsx
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { groupGameInterestRows, type RawGameInterestRow } from '@/lib/games/game-interest-segment'
import { GameInterestExportButtons } from '@/components/admin/GameInterestExportButtons'

export const metadata: Metadata = { title: 'Game Interest · Admin · SentinelX' }

export default async function AdminGameInterestPage({
  searchParams,
}: {
  searchParams: { game?: string; country?: string }
}) {
  await requireStaff()
  const admin = createAdminClient()
  const { data: games } = await admin.from('games').select('id, name').order('name')

  let query = admin
    .from('game_interest')
    .select('user_id, profiles!inner(id, username, display_name, country, whatsapp_number, consent_whatsapp_updates), games!inner(name)')
    .eq('profiles.consent_whatsapp_updates', true)
  if (searchParams.game) query = query.eq('game_id', searchParams.game)
  if (searchParams.country) query = query.eq('profiles.country', searchParams.country)
  const { data: rawRows } = await query

  const players = groupGameInterestRows((rawRows ?? []) as unknown as RawGameInterestRow[])
  const countries = Array.from(new Set(players.map((p) => p.country).filter((c): c is string => !!c))).sort()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Game Interest</h1>
      <form className="mb-6 flex gap-3" method="get">
        <select name="game" defaultValue={searchParams.game ?? ''} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="">All games</option>
          {(games ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select name="country" defaultValue={searchParams.country ?? ''} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-white hover:border-slate-500">
          Filter
        </button>
      </form>

      <GameInterestExportButtons game={searchParams.game} country={searchParams.country} />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm text-slate-300">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Player</th>
              <th>Country</th>
              <th>WhatsApp</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-2">{p.name}</td>
                <td>{p.country ?? '—'}</td>
                <td>{p.whatsappNumber ?? '—'}</td>
                <td>{p.games}</td>
              </tr>
            ))}
            {players.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-500">
                  No consenting players match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

```tsx
// components/admin/GameInterestExportButtons.tsx
'use client'
import { useState } from 'react'
import { exportContactNumbers, exportContactCsv } from '@/lib/games/game-interest-admin-actions'

export function GameInterestExportButtons({ game, country }: { game?: string; country?: string }) {
  const [copied, setCopied] = useState(false)

  async function copyNumbers() {
    const { numbers } = await exportContactNumbers(game, country)
    await navigator.clipboard.writeText(numbers.join(', '))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function downloadCsv() {
    const { csv } = await exportContactCsv(game, country)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'game-interest-contacts.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={copyNumbers} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {copied ? 'Copied!' : 'Copy Numbers'}
      </button>
      <button type="button" onClick={downloadCsv} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-white hover:border-slate-500">
        Download CSV
      </button>
    </div>
  )
}
```

Note: `profiles!inner(...)` and `games!inner(...)` each resolve to a single object, not an array, because both are many-to-one foreign keys from `game_interest` (one `game_interest` row references exactly one `profiles` row and one `games` row) — the same shape `lib/notifications/push.ts:93`'s `fcm_tokens.select('id, token, profiles!inner(...)')` already relies on (`r.profiles as {...} | null`, not `r.profiles[0]`). The `as unknown as RawGameInterestRow[]` cast in `page.tsx` (and in `game-interest-admin-actions.ts` from Step 2) is there only because the generated `Database` type doesn't know about this specific joined shape, not because the object/array question is actually ambiguous.

- [ ] **Step 4: Manual browser verification**

Run the dev server, sign in as staff, navigate to `/admin/players/game-interest`:
- Confirm the game/country filters narrow the table.
- Confirm a player who has not set `consent_whatsapp_updates = true` never appears, even if they have `game_interest` rows.
- Click "Copy Numbers" and paste somewhere to confirm a comma-joined list of real E.164 numbers.
- Click "Download CSV" and open the file to confirm the header row and one row per player, with multi-game players combined.
- Confirm the "Game Interest" tab appears in the admin nav between "Players" and "Community".

- [ ] **Step 5: Run the full test suite one final time**

Run: `npx vitest run`
Expected: PASS, full suite green

- [ ] **Step 6: Commit**

```bash
git add lib/admin/nav.ts app/\[locale\]/admin/players/game-interest lib/games/game-interest-admin-actions.ts components/admin/GameInterestExportButtons.tsx
git commit -m "feat(admin): add the Game Interest WhatsApp-outreach segment page"
```

---

## Final check

- [ ] Run `npx vitest run` once more from a clean state to confirm the whole suite (all 15 tasks' worth of new/changed tests) is green together.
- [ ] Run `npm run lint` and `npm run build` — per `[[project_mobile_phase0b_api_foundation]]`, `tsc --noEmit` clean does not imply `next build` clean, since ESLint also runs inside `next build`.
- [ ] Confirm `openapi/mobile-v1.json` has no uncommitted diff (Task 13's regeneration should already be committed, but a later task's edits to `lib/profile/schema.ts` shape could theoretically ripple into it — re-run `npm run openapi` and check `git status` if in doubt).
- [ ] Not a task in this plan, but flag it to the user per spec §11: once this ships, `/onboarding/profile` becomes compulsory for every player on their next `/dashboard` visit, including mobile users signed in through the `sentinelx_mobile` Flutter app, which has no equivalent screen. A mobile-only player will be unable to pass the web gate from the app itself (they'd need to open the site in a browser once). Whether `sentinelx_mobile` needs a coordinated release before this ships is a rollout decision for the user, not something this plan resolves.
