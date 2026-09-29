# Player Profile Completion, WhatsApp Consent & Game-Interest Outreach — Design Spec

**Date:** 2026-09-29
**Status:** Approved design → ready for planning
**Builds on:** `2026-07-28-google-signin-phone-whatsapp-verification-design.md` (onboarding gate chain, `lib/phone/number.ts`), `048_game_interest.sql` (Coming Soon "Notify Me")

---

## 1. Problem

Admin (Samuel) wants to run manual WhatsApp outreach to players segmented by game and country — e.g. "everyone interested in EA FC Mobile, in Nigeria, who's said yes to WhatsApp contact." Today there's no way to build that list:

- `country` and `whatsapp_number` exist on `profiles` but are optional, freely-typed, and validated by a loose regex (`lib/profile/schema.ts:9`) — not normalized to E.164, not guaranteed to actually be a valid number for the player's country.
- There's no general "which games is this player interested in" signal. `game_interest` (`048_game_interest.sql`) exists but only records Coming-Soon "Notify Me" clicks — a narrow, incidental signal, not something every player has an opportunity to state.
- There's no consent flag scoped to manual outreach. `notification_prefs.whatsapp.*` (live, `lib/notifications/notify.ts`) already gates the *automated* Termii pipeline per notification type — a different, narrower concern (see §2 non-goals).
- No admin page can filter/export a WhatsApp contact list at all.

## 2. Goals

- Every player (new and existing) ends up with a validated, E.164-normalized `whatsapp_number`, a `country`, an explicit `consent_whatsapp_updates` answer, and at least one `game_interest` row.
- Getting there is **compulsory** — enforced via the existing onboarding-gate mechanism, for new and existing players alike — but consent itself is a genuine yes/or/no, never coerced to yes.
- Admin can filter consenting players by game and/or country and pull a contact list (copy or CSV) for manual outreach.
- All four fields stay editable afterward from Dashboard Settings.

### Non-goals

- **Not touching the automated Termii WhatsApp pipeline** (`notification_prefs.whatsapp.*`, `lib/notifications/notify.ts`). `consent_whatsapp_updates` is a separate, narrower flag that gates only the new admin outreach page — confirmed explicitly, since the two could easily be conflated. A player can consent to one, both, or neither.
- **Not touching the disabled phone-OTP verification system** (`profiles.phone`/`phone_verified_at`, `lib/phone/actions.ts`, `ENFORCE_PHONE_VERIFICATION = false`). That verifies identity via a WhatsApp OTP into a *different* column; this spec's `whatsapp_number` stays the existing, self-reported (but now properly validated) contact number.
- **Tournament-to-interest matching** (flagging which `game_interest` players match a newly created tournament) — explicitly deferred; this spec only builds the data and the segment-list page it depends on.
- No signup-wizard changes — collection happens post-signup (§4), the wizard (`SignupWizard.tsx`) stays exactly as it is today, matching the existing precedent that phone verification also happens post-signup, not during the wizard.

## 3. Schema

```sql
-- 20260929120000_add_profile_completion_fields.sql
ALTER TABLE public.profiles ADD COLUMN consent_whatsapp_updates boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN profile_completed_at timestamptz;

-- Public: middleware's RLS-scoped client needs to read this to drive the
-- gate, same reasoning as phone_verified_at. Column grants are additive, so
-- this doesn't need to restate the full allow-list from 20260918200000_*.
GRANT SELECT (profile_completed_at) ON public.profiles TO anon, authenticated;

-- consent_whatsapp_updates is NOT granted — private, admin-client-only reads,
-- same as whatsapp_number. Add it to PRIVATE_PROFILE_COLUMNS below.
```

`country` and `whatsapp_number` already exist (`001_initial_schema.sql:57,59`) — no new columns for those, only new validation (§5). `game_interest` (`048_game_interest.sql`) is reused as-is — no schema change, see §6.

`lib/security/write-paths.test.ts:24` — add `consent_whatsapp_updates` to `PRIVATE_PROFILE_COLUMNS`. `profile_completed_at` is deliberately **not** added — it's public.

## 4. Compulsory onboarding gate

Extends the existing chain in `lib/onboarding/gate.ts` (currently username → phone, phone disabled via `ENFORCE_PHONE_VERIFICATION`):

```ts
export type OnboardingGate = '/onboarding/username' | '/onboarding/phone' | '/onboarding/profile' | null

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

`lib/supabase/middleware.ts`: extend `onboardingProfile()`'s select (line 54) to `'username, phone_verified_at, profile_completed_at'`, extend `OnboardingProfile` (line 42), pass `profileCompletedAt: profile.profile_completed_at` into `resolveOnboardingGate()`.

**Applies to everyone, not grandfathered.** Unlike the 2026-07-28 phone feature (which explicitly grandfathered existing players because phone verification wasn't a signup-time requirement for them), `profile_completed_at` starts `NULL` for every existing row and stays that way until they pass the gate — so all players, old and new, hit `/onboarding/profile` on their next `/dashboard` visit. This is the point: the admin segment list needs to actually cover the existing player base, not just future signups.

### New route: `app/[locale]/(auth)/onboarding/profile/page.tsx`

Same shape as `onboarding/phone/page.tsx`: server component, `redirect('/login?next=/onboarding/profile')` if no session, `redirect('/dashboard')` if `profile_completed_at` already set, otherwise renders a client form component.

Fields:
- **Country** — `<select>`, no default selection, built from a new `listCountries()` helper (§5.1). First option is a disabled placeholder ("Select your country").
- **WhatsApp number** — text input, `type="tel"`, validated against the selected country on submit.
- **Game interests** — checklist of all `games` rows (`id, name, icon_url`, both active and inactive — "plan to support" per the original ask includes Coming Soon titles), pre-populated from any existing `game_interest` rows for this user (so a prior Coming-Soon "Notify Me" click already shows checked, not silently lost).
- **Consent checkbox** — "I agree to receive tournament updates on WhatsApp," unchecked by default. Implemented as a controlled checkbox mirrored into a hidden input (so the field is always present in the submitted `FormData` whether checked or not — a `<input type="checkbox">` alone omits itself from `FormData` when unchecked, which would make "no" indistinguishable from "not answered").

Validation: new `lib/onboarding/profile-schema.ts`:
```ts
export const onboardingProfileSchema = z.object({
  country: z.string().trim().min(1, 'Select your country'),
  whatsapp: z.string().trim().min(1, 'Enter your WhatsApp number'),
  consentWhatsappUpdates: z.enum(['true', 'false']), // hidden input is always a string
  gameInterests: z.array(z.string().uuid()).min(1, 'Select at least one game'),
})
```
(`gameInterests` arrives as repeated `FormData` entries under one key — parsed the same way any existing multi-value form field in this codebase is, no new pattern.)

### Server action: `lib/onboarding/actions.ts` → `completeProfileOnboarding()`

1. Parse against `onboardingProfileSchema`.
2. `const phone = parsePlayerPhone(input.whatsapp, { country: input.country })` — reject with a field error if `null` (invalid for that country's numbering plan). This is the exact validator the original ask wanted (`libphonenumber-js`-backed, country-aware, E.164 output) — it already exists (`lib/phone/number.ts`), just wasn't wired into a save path yet.
3. `createAdminClient().from('profiles').update({ country: input.country, whatsapp_number: phone.e164, consent_whatsapp_updates: input.consentWhatsappUpdates === 'true', profile_completed_at: new Date().toISOString() }).eq('id', userId)` — `profiles` is server-only-write (§ CLAUDE.md rule 9), matches every existing profile write.
4. `replaceGameInterests(supabase, userId, input.gameInterests)` (§6) — via the **session-scoped** client, since `game_interest` already grants authenticated users insert/delete on their own rows (`048_game_interest.sql:17-23`); no admin escalation needed here, keeping the blast radius of the admin client to just the `profiles` write.
5. On success, `redirect('/dashboard')` (or `next`, matching the existing onboarding pages' convention).

## 5. Validation fix that falls out of this (existing Settings path)

`lib/profile/schema.ts`'s `whatsapp` field currently validates with a standalone regex, disconnected from `country`, and is never normalized before being stored (`update-profile-service.ts:39` stores `input.whatsapp` verbatim). This is exactly the gap the original ask flagged — and the fix already exists in the codebase (`lib/phone/number.ts`'s `parsePlayerPhone`), it just isn't wired in. Fixing it here, since Settings is the other place these same fields get edited:

```ts
// lib/profile/schema.ts
export const profileEditSchema = z.object({
  // ...existing fields unchanged...
  whatsapp: z.union([z.literal(''), z.string().trim().max(30)]),
  gameInterests: z.array(z.string().uuid()).optional(),        // NEW — omitted = leave unchanged
  consentWhatsappUpdates: z.boolean().optional(),               // NEW — omitted = leave unchanged
}).superRefine((val, ctx) => {
  if (val.whatsapp && !parsePlayerPhone(val.whatsapp, { country: val.country })) {
    ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid WhatsApp number for the selected country' })
  }
})
```

`gameInterests`/`consentWhatsappUpdates` are **optional** here (unlike the onboarding schema) so the existing mobile `PATCH /me/profile` contract doesn't break for callers that don't send them — see §7.

`update-profile-service.ts`'s `performUpdateProfile()`:
```ts
const parsed = input.whatsapp ? parsePlayerPhone(input.whatsapp, { country: input.country }) : null
// ...
const { error } = await admin.from('profiles').update({
  display_name: input.displayName,
  whatsapp_number: parsed?.e164 ?? null,
  country: input.country || null,
  bio: input.bio || null,
  ...(input.consentWhatsappUpdates !== undefined ? { consent_whatsapp_updates: input.consentWhatsappUpdates } : {}),
  ...avatarPatch,
  ...usernamePatch,
}).eq('id', userId)

if (input.gameInterests !== undefined) {
  const result = await replaceGameInterests(supabase, userId, input.gameInterests)
  if (!result.ok) return { ok: false, errorCode: 'save_failed' }
}
```

### 5.1 Country dropdown

New export in `lib/phone/number.ts` (reuses the exact `getCountries()`/`Intl.DisplayNames` machinery `countryToRegion()` already builds, so a selected country round-trips through `countryToRegion()` with no ambiguity):
```ts
export function listCountries(): { code: CountryCode; name: string }[] {
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  return getCountries()
    .map((code) => ({ code, name: display.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
```
`profiles.country` keeps storing the display name (no column type change) — old free-text rows ("Nigerian", "naija", etc.) keep resolving fine via the existing alias table; only the new dropdown constrains *future* writes to canonical names.

## 6. `game_interest` — repurposed, not replaced

No schema change. New shared helper:

```ts
// lib/games/game-interest-service.ts
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

Full-replace semantics (delete-then-insert), not an append log — the checklist represents current interest, not a click history. `NotifyMeButton.tsx` (Coming Soon page) is **unchanged** — it still inserts/deletes its own single row directly via the session client; because it's the same table, a Notify-Me click before onboarding shows pre-checked in the onboarding/settings checklist, and a game checked in the checklist shows the Notify-Me button as already-active. No migration needed for existing `game_interest` rows.

## 7. Mobile API touch point

`profileEditSchema` backs `updateProfileEndpoint` (`lib/mobile-api/endpoints/me.ts:81,93`), so the two new optional fields flow through to `PATCH /api/mobile/v1/me/profile` automatically. Also extend `meEndpoint`'s response (line 74's select + line 52-53's mapping) to include `consentWhatsappUpdates`/`gameInterests` for symmetry, sourced from a `game_interest` lookup alongside the existing `profiles` select.

Since this changes the mobile API contract shape (even additively), per CLAUDE.md rule 11: run `npm run openapi`, commit `openapi/mobile-v1.json`. This spec does **not** include building onboarding-equivalent UI in the Flutter app (`sentinelx_mobile`) — out of scope, flagged as a handoff note for that repo, same pattern as the registration-fields spec's §4.5 handled it.

## 8. Admin — "Game Interest" segment page

New route `app/[locale]/admin/players/game-interest/page.tsx`, added to `ADMIN_NAV` (`lib/admin/nav.ts`) as `{ label: 'Game Interest', href: '/admin/players/game-interest', adminOnly: false }`.

Follows the `admin/players/page.tsx` pattern exactly: `requireStaff()`, `createAdminClient()` (required — `whatsapp_number`/`consent_whatsapp_updates` are private columns), server-side filtering via `searchParams` (`game`, `country`), plain `<table>`.

```ts
await requireStaff()
const admin = createAdminClient()
const { data: games } = await admin.from('games').select('id, name').order('name')

let query = admin
  .from('game_interest')
  .select('user_id, profiles!inner(id, username, display_name, country, whatsapp_number, consent_whatsapp_updates)')
  .eq('profiles.consent_whatsapp_updates', true)
if (searchParams.game) query = query.eq('game_id', searchParams.game)
if (searchParams.country) query = query.eq('profiles.country', searchParams.country)
const { data: rows } = await query
```
(Grouped by `user_id` in-memory afterward — a player interested in 3 games appears once per game in the raw join, collapsed to one row with a combined game-interest label for display, same in-memory approach `matchesPlayerQuery` already uses for the players page rather than a DB-side aggregate.)

**Filters:** two `<select>` dropdowns (game — from `games`; country — from `listCountries()`, or simpler: distinct countries actually present in `rows`), submitted via the existing GET-form pattern.

**Export**, both via one server action (`requireStaff()`-gated, same as the page):
- **Copy numbers** — client button, calls the action, gets back `{ numbers: string[] }` (E.164), joins with commas, `navigator.clipboard.writeText()`.
- **Download CSV** — client button, calls the action, gets back a CSV string (`name, country, whatsapp_number, game_interests`), triggers a client-side `Blob` download (`new Blob([csv], { type: 'text/csv' })` + a temporary `<a download>`). No new route handler — avoids re-deriving the `/admin` middleware/staff-gate story for a `route.ts`, and matches how the rest of this codebase keeps privileged reads inside Server Actions rather than API routes.

## 9. Rollout order

1. Schema migration (§3) + `PRIVATE_PROFILE_COLUMNS` update
2. `lib/phone/number.ts`: add `listCountries()`
3. `lib/games/game-interest-service.ts`: `replaceGameInterests()`
4. Onboarding: gate chain (§4), `/onboarding/profile` route + form + action
5. Settings: extend `profileEditSchema`/`performUpdateProfile` (§5), add game-interests checklist + consent checkbox to `ProfileForm`
6. Mobile: extend `meEndpoint`/`updateProfileEndpoint` (§7), regenerate OpenAPI
7. Admin: `/admin/players/game-interest` page + export action (§8), nav entry

One integrated change — no partial ship, since the gate (step 4) and the admin page (step 7) are the two ends of the same data pipe and neither is useful alone.

## 10. Testing

- `lib/onboarding/gate.ts` — unit tests for the three-way priority chain (username → phone → profile → null), mirroring existing gate test coverage style
- `lib/onboarding/profile-schema.ts` / the onboarding action — required-field rejection, invalid-number rejection (country-specific: a South African-shaped number should fail against `country: 'Nigeria'`), consent stored as typed (checked and unchecked both pass), `profile_completed_at` set only on success
- `lib/profile/schema.ts` — `whatsapp`+`country` cross-field validation via `superRefine`, `gameInterests`/`consentWhatsappUpdates` omission leaves existing values untouched
- `lib/games/game-interest-service.ts` — replace semantics (empty array clears all, re-selecting the same set is a no-op-safe delete+reinsert)
- `lib/security/write-paths.test.ts` — passes with `consent_whatsapp_updates` added to the private list (existing ratchet, no new test file needed)
- Admin page: staff-gate, filter-by-game, filter-by-country, consent=false rows excluded, CSV/copy export shape

## 11. Open questions

None blocking. Whether `sentinelx_mobile` needs a coordinated release to build onboarding-equivalent UI (so mobile-only signups aren't stuck unable to pass the web gate) is a rollout-communication detail for the implementation plan, not an architecture question — flagged in §7.
