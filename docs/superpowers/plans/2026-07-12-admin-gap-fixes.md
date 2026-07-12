# Admin gap fixes (#15–#20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six admin-flagged gaps: per-registration player details + admin verification list, GF/GA columns on the league table, a 3-tab platform leaderboard, admin player search, Markdown tournament rules with a registration agreement gate, dashboard fixture polish, and a live registration-deadline countdown.

**Architecture:** Everything builds on the existing v1.0–v3.0 codebase (Next.js 14 App Router, Supabase, Server Actions, Tailwind). One consolidated migration adds the new columns. New pure logic (search filtering, registration validation, countdown math, ranking-by-metric) lives in small `lib/` modules with vitest unit tests, matching every existing `lib/` file in this repo. UI changes extend existing Server Components and the handful of already-established client components (tab groups, forms) rather than introducing new patterns.

**Tech Stack:** Next.js 14 (App Router, Server Actions), TypeScript, Supabase (Postgres + RLS), Tailwind CSS, Zod, Vitest. One new dependency: `react-markdown` (rules rendering).

## Global Constraints

- Mobile-first — design for 375px width, scale up (CLAUDE.md).
- Use Supabase Row Level Security (RLS) on every table — this plan adds columns to existing RLS-protected tables; no new tables, so no new policies are needed (see Task 4 for why the registration write path uses the existing admin-client precedent instead of new RLS).
- Admin routes must never be reachable by non-admin/non-staff users — every admin page and action calls `requireStaff()`/`requireAdmin()` (`lib/admin/auth.ts`), matching every existing admin page in this codebase.
- All Paystack-adjacent server actions must validate server-side — never trust client input for anything that gates payment or registration state.
- No registration approval/rejection gate — payment webhook auto-confirms exactly as today (per spec, explicitly out of scope).
- No new server-side aggregation for the leaderboard — read existing maintained `profiles` columns only.
- No debounced/server-side search — admin lists are small (≤64 players per tournament) and already fully loaded; filter client-side.
- Tournament rules checkbox only proves it was checked at submit time — no comprehension verification is implemented or implied.
- Every code file this plan touches already exists in a specific style (Server Component data-fetching + typed row mapping, Zod schemas mirroring `lib/tournaments/admin-schema.ts`, Tailwind utility classes matching neighboring components) — follow it exactly; do not introduce new conventions.

---

## File Structure

**New files:**
- `supabase/migrations/015_registration_details.sql` — schema migration.
- `lib/admin/search.ts` + `lib/admin/search.test.ts` — shared player-search filter (case-insensitive substring on username/display name/club name).
- `lib/tournaments/registration-schema.ts` + `.test.ts` — Zod schema for the 4 new registration fields.
- `lib/tournaments/countdown.ts` + `.test.ts` — pure countdown-math for #20.
- `components/tournament/RegistrationCountdown.tsx` — client countdown display.
- `components/admin/PlayerSearch.tsx` — shared search input, used on 3 admin pages.
- `components/admin/RegistrationsTable.tsx` — admin registrations list (client, holds search state).
- `app/admin/tournaments/[id]/registrations/page.tsx` — admin registrations route.
- `components/admin/AdminBracketView.tsx` — client wrapper adding search to the admin bracket page's standings.
- `components/admin/AdminResultsQueue.tsx` — client wrapper adding search to the admin results queue (absorbs the `Bucket` renderer currently inline in `app/admin/results/page.tsx`).
- `components/rankings/LeaderboardTabs.tsx` — client tab switcher (Wins / Sentinel Score / Goals).

**Modified files:**
- `lib/supabase/types.ts` — extend `tournament_registrations` and `tournaments` Row/Insert/Update types.
- `lib/tournaments/actions.ts` — `registerForTournament` validates + persists the 4 fields, gates on rules agreement, writes via `createAdminClient()`.
- `components/tournament/RegistrationPanel.tsx` — `RegisterForm` gains the 4 fields (prefilled) and the rules checkbox.
- `app/(public)/tournaments/[slug]/page.tsx` — fetches `rules` + profile prefill, renders the rules block and `RegistrationCountdown`.
- `lib/tournaments/standings.ts` — `MembershipInput`/`StandingRow` gain optional `clubName`.
- `components/bracket/StandingsTable.tsx` — add GF/GA columns.
- `lib/tournaments/bracket-view.ts` — join `reg_club_name` into standings rows.
- `app/admin/tournaments/[id]/bracket/page.tsx` — render `AdminBracketView` instead of `GroupStage`/`KnockoutBracket` directly.
- `lib/rankings/leaderboard.ts` — add `LeaderboardMetric`, `rankPlayersBy`; `rankPlayers` becomes a thin wrapper.
- `components/rankings/LeaderboardTable.tsx` — `metric` prop drives which stat is emphasized.
- `app/(public)/rankings/page.tsx` — render `LeaderboardTabs` instead of `LeaderboardTable` directly.
- `lib/matches/review-queue.ts` — `ReviewMatchInput` gains optional `playerAClubName`/`playerBClubName`.
- `app/admin/results/page.tsx` — joins club names, delegates rendering to `AdminResultsQueue`.
- `lib/tournaments/admin-schema.ts` — `rules` field.
- `lib/tournaments/admin-actions.ts` — `parseForm`/`toRow` carry `rules`.
- `components/admin/TournamentForm.tsx` — rules textarea.
- `app/admin/tournaments/[id]/edit/page.tsx`, `app/admin/tournaments/new/page.tsx` — thread `rules` through initial values.
- `components/admin/TournamentListRow.tsx` — add a "Registrations" nav link.
- `lib/tournaments/bracket.ts` — add `group: 'Group Stage'` to `ROUND_LABELS`.
- `components/dashboard/FixtureCard.tsx` — show the round label.
- `package.json` — add `react-markdown`.
- `ROADMAP.md` — renumber, mark complete.

---

### Task 1: Migration + Supabase types

**Files:**
- Create: `supabase/migrations/015_registration_details.sql`
- Modify: `lib/supabase/types.ts:732-773` (`tournament_registrations`), `lib/supabase/types.ts:774-831` (`tournaments`)

**Interfaces:**
- Produces: DB columns `tournament_registrations.reg_display_name/reg_whatsapp/reg_club_name/reg_ign_tag` (text, nullable) and `tournaments.rules` (text, nullable), reflected in `Database['public']['Tables']['tournament_registrations']` and `['tournaments']`.

This task has no application logic to test — it's schema only. Verification is a successful `npm run test` (nothing should reference the new columns yet) and a TypeScript check after Task 1 lands (deferred to the final verification task, since no code references these types yet).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/015_registration_details.sql`:

```sql
-- =============================================================
-- #15/#18 — Registration detail fields + tournament rules
-- =============================================================

ALTER TABLE public.tournament_registrations
  ADD COLUMN reg_display_name text,
  ADD COLUMN reg_whatsapp     text,
  ADD COLUMN reg_club_name    text,
  ADD COLUMN reg_ign_tag      text;

ALTER TABLE public.tournaments
  ADD COLUMN rules text;
```

- [ ] **Step 2: Apply the migration**

Run against the project's Supabase instance (same tool/flow used for prior migrations — e.g. `supabase db push` or the SQL editor, per this repo's existing workflow). Confirm no errors.

- [ ] **Step 3: Update generated types**

Edit `lib/supabase/types.ts`. In the `tournament_registrations` block (currently lines 732-773), add the four new fields to `Row`, `Insert`, and `Update`:

```ts
      tournament_registrations: {
        Row: {
          id: string
          payment_status: string
          paystack_reference: string | null
          player_id: string
          reg_club_name: string | null
          reg_display_name: string | null
          reg_ign_tag: string | null
          reg_whatsapp: string | null
          registered_at: string
          tournament_id: string
        }
        Insert: {
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id: string
          reg_club_name?: string | null
          reg_display_name?: string | null
          reg_ign_tag?: string | null
          reg_whatsapp?: string | null
          registered_at?: string
          tournament_id: string
        }
        Update: {
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id?: string
          reg_club_name?: string | null
          reg_display_name?: string | null
          reg_ign_tag?: string | null
          reg_whatsapp?: string | null
          registered_at?: string
          tournament_id?: string
        }
```

(Keep the existing `Relationships` array unchanged below it.)

In the `tournaments` block (currently lines 774+), add `rules` to `Row`, `Insert`, and `Update` (alphabetical, after `registration_start`):

```ts
      tournaments: {
        Row: {
          banner_url: string | null
          created_at: string
          description: string | null
          format: string
          game_id: string
          id: string
          max_players: number | null
          prize_pool: number
          registration_end: string | null
          registration_fee: number
          registration_start: string | null
          rules: string | null
          slug: string
          status: string
          title: string
          tournament_end: string | null
          tournament_start: string | null
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          format?: string
          game_id: string
          id?: string
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          rules?: string | null
          slug: string
          status?: string
          title: string
          tournament_end?: string | null
          tournament_start?: string | null
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          format?: string
          game_id?: string
          id?: string
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          rules?: string | null
          slug?: string
          status?: string
          title?: string
          tournament_end?: string | null
          tournament_start?: string | null
          updated_at?: string
        }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/015_registration_details.sql lib/supabase/types.ts
git commit -m "feat: #15/#18 add registration detail + tournament rules columns"
```

---

### Task 2: Admin player search filter

**Files:**
- Create: `lib/admin/search.ts`
- Test: `lib/admin/search.test.ts`

**Interfaces:**
- Produces: `matchesPlayerQuery(item: { username: string | null; displayName: string | null; clubName?: string | null }, query: string): boolean` — consumed by Tasks 6, 9, 10.

- [ ] **Step 1: Write the failing test**

Create `lib/admin/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesPlayerQuery } from './search'

describe('matchesPlayerQuery', () => {
  it('matches a blank query against anything', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, clubName: null }, '')).toBe(true)
    expect(matchesPlayerQuery({ username: null, displayName: null, clubName: null }, '')).toBe(true)
  })

  it('matches a case-insensitive username substring', () => {
    expect(matchesPlayerQuery({ username: 'DarkStrikerNG', displayName: null, clubName: null }, 'strike')).toBe(
      true,
    )
  })

  it('matches a case-insensitive display name substring', () => {
    expect(
      matchesPlayerQuery({ username: null, displayName: 'Samuel Okoro', clubName: null }, 'okoro'),
    ).toBe(true)
  })

  it('matches a case-insensitive club name substring', () => {
    expect(
      matchesPlayerQuery({ username: 'x', displayName: null, clubName: 'Lagos Ronin' }, 'ronin'),
    ).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(
      matchesPlayerQuery({ username: 'zee', displayName: 'Zee Player', clubName: 'Ronin' }, 'nomatch'),
    ).toBe(false)
  })

  it('does not crash when all fields are null and query is non-empty', () => {
    expect(matchesPlayerQuery({ username: null, displayName: null, clubName: null }, 'x')).toBe(false)
  })

  it('trims and ignores leading/trailing whitespace in the query', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, clubName: null }, '  zee  ')).toBe(
      true,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/admin/search.test.ts`
Expected: FAIL — `Cannot find module './search'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/admin/search.ts`:

```ts
export interface SearchablePlayer {
  username: string | null
  displayName: string | null
  clubName?: string | null
}

// Case-insensitive substring match against username, display name, and club
// name. A blank/whitespace-only query matches everything (no filter applied).
export function matchesPlayerQuery(item: SearchablePlayer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [item.username, item.displayName, item.clubName].some(
    (field) => field != null && field.toLowerCase().includes(q),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/admin/search.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/admin/search.ts lib/admin/search.test.ts
git commit -m "feat: #17 add shared admin player-search filter"
```

---

### Task 3: Registration details schema

**Files:**
- Create: `lib/tournaments/registration-schema.ts`
- Test: `lib/tournaments/registration-schema.test.ts`

**Interfaces:**
- Consumes: none (pure Zod schema, mirrors `lib/tournaments/admin-schema.ts`'s style).
- Produces: `registrationDetailsSchema: ZodObject`, `type RegistrationDetailsInput = { displayName: string; whatsapp: string; clubName: string; ignTag: string }` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/registration-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { registrationDetailsSchema } from './registration-schema'

const valid = {
  displayName: 'Samuel O.',
  whatsapp: '+2348012345678',
  clubName: 'Lagos Ronin',
  ignTag: 'DarkStrikerNG',
}

describe('registrationDetailsSchema', () => {
  it('accepts valid input', () => {
    expect(registrationDetailsSchema.safeParse(valid).success).toBe(true)
  })

  it('requires displayName', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, displayName: '  ' }).success).toBe(false)
  })

  it('requires clubName', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, clubName: '' }).success).toBe(false)
  })

  it('requires ignTag', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, ignTag: '' }).success).toBe(false)
  })

  it('requires a plausible WhatsApp number', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, whatsapp: 'not a number' }).success).toBe(
      false,
    )
  })

  it('accepts a WhatsApp number without a leading +', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, whatsapp: '08012345678' }).success).toBe(
      true,
    )
  })

  it('trims surrounding whitespace', () => {
    const r = registrationDetailsSchema.safeParse({ ...valid, displayName: '  Samuel O.  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.displayName).toBe('Samuel O.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/tournaments/registration-schema.test.ts`
Expected: FAIL — `Cannot find module './registration-schema'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/tournaments/registration-schema.ts`:

```ts
import { z } from 'zod'

export const registrationDetailsSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required')
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
  clubName: z.string().trim().min(1, 'Club name is required').max(60, 'Club name is too long'),
  ignTag: z
    .string()
    .trim()
    .min(1, 'In-game player ID / tag is required')
    .max(60, 'In-game player ID / tag is too long'),
})

export type RegistrationDetailsInput = z.infer<typeof registrationDetailsSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/tournaments/registration-schema.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/registration-schema.ts lib/tournaments/registration-schema.test.ts
git commit -m "feat: #15 add registration details validation schema"
```

---

### Task 4: `registerForTournament` persists registration details + rules gate

**Files:**
- Modify: `lib/tournaments/actions.ts` (full file — shown below)

**Interfaces:**
- Consumes: `registrationDetailsSchema` (Task 3), `createAdminClient` from `@/lib/supabase/admin` (existing, used identically in `lib/kyc/actions.ts:78`).
- Produces: `registerForTournament` now writes `reg_display_name`, `reg_whatsapp`, `reg_club_name`, `reg_ign_tag` on both the insert and the update-existing-pending-row paths, and rejects submission with `{ error: 'Please confirm you have read and agree to the rules.' }` when the tournament has non-empty `rules` and `formData.get('agreedToRules') !== 'true'`. Consumed by Task 5 (form UI) and Task 12 (rules checkbox UI) — no signature change, so those tasks add UI without touching this function again.

No new pure logic here (the validation itself is already tested in Task 3; the rules-gate condition is a one-line branch not worth a unit test — it's exercised by hand in the final verification task). This task is TDD via Task 3's schema; here we wire it into the action.

**Why `createAdminClient()` for the writes:** `tournament_registrations` RLS only permits `UPDATE` by staff (`tr_staff_update`, `supabase/migrations/001_initial_schema.sql:402`) — a player has no self-update policy. This codebase's established pattern for a player-facing Server Action that needs a privileged write is `lib/kyc/actions.ts`'s `submitKyc`: use `createClient()` for the read/auth-check and `createAdminClient()` for the mutation, after the action's own code has already validated the request. `registerForTournament` follows the same shape — it validates ownership (`auth.getUser()`), tournament state (`checkCanRegister`), and input (`registrationDetailsSchema`) before ever calling the admin client, so the admin client isn't a trust bypass — the Server Action's own logic is the trust boundary, exactly as it is for KYC.

- [ ] **Step 1: Replace the file**

Replace the full contents of `lib/tournaments/actions.ts`:

```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { checkCanRegister } from './guard'
import { registrationDetailsSchema } from './registration-schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type RegisterState = { error?: string } | undefined

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = registrationDetailsSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    clubName: formData.get('clubName') ?? '',
    ignTag: formData.get('ignTag') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  // Re-fetch server-side; never trust the client for status, capacity, or rules.
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  // Only proves the checkbox was ticked at submit time — there is no way to
  // verify a player actually read the rules, and this deliberately doesn't try.
  if (tournament.rules && formData.get('agreedToRules') !== 'true') {
    return { error: 'Please confirm you have read and agree to the rules.' }
  }

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

  const regFields = {
    reg_display_name: parsed.data.displayName,
    reg_whatsapp: parsed.data.whatsapp,
    reg_club_name: parsed.data.clubName,
    reg_ign_tag: parsed.data.ignTag,
  }

  // Player has no self-UPDATE RLS policy on tournament_registrations (staff-only,
  // see migration 001) — writes go through the admin client, same pattern as
  // lib/kyc/actions.ts's submitKyc. The Server Action's own validation above
  // (auth, tournament state, input schema) is the trust boundary.
  const admin = createAdminClient()

  // Reuse the pending row's reference; otherwise create a fresh pending row.
  let reference = existing?.paystack_reference ?? null
  if (!existing) {
    reference = buildReference(tournamentId, user.id)
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    if (!reference) reference = buildReference(tournamentId, user.id)
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, ...regFields })
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

- [ ] **Step 2: Run the full test suite to confirm nothing else broke**

Run: `npm run test`
Expected: PASS — this file has no direct unit tests (it's a Server Action exercising Paystack/Supabase side effects), but `lib/tournaments/guard.test.ts` and `lib/tournaments/registration-schema.test.ts` must still pass unchanged.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/actions.ts
git commit -m "feat: #15/#18 registerForTournament persists registration details + rules gate"
```

---

### Task 5: Registration form UI (4 fields, prefilled)

**Files:**
- Modify: `components/tournament/RegistrationPanel.tsx` (full file — shown below)
- Modify: `app/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Consumes: `Field` from `@/components/dashboard/FormField` (existing, used identically in `components/dashboard/KycForm.tsx`), `registerForTournament` (Task 4, unchanged signature).
- Produces: `RegistrationPanel` now requires a `prefill: { displayName: string; whatsapp: string }` prop. Task 12 will add a `hasRules: boolean` prop to this same component (a second, later modification — expected).

No new pure logic — this is presentational wiring. No test to write (this codebase has no component tests; UI correctness is checked in the final verification task's manual pass, per the `verify` skill).

- [ ] **Step 1: Replace `RegistrationPanel.tsx`**

Replace the full contents of `components/tournament/RegistrationPanel.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { registerForTournament, type RegisterState } from '@/lib/tournaments/actions'
import type { RegView } from '@/lib/tournaments/view'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

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
  prefill,
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
  prefill: { displayName: string; whatsapp: string }
}) {
  const bracketHref = `/tournaments/${slug}/bracket`

  if (view === 'guest') {
    return (
      <div className={box}>
        <Link
          href={loginHref}
          className="block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          Register — {formatNaira(fee)}
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
          prefill={prefill}
          label={
            view === 'complete_payment' ? 'Complete payment →' : `Register — ${formatNaira(fee)}`
          }
        />
        <p className="mt-2 text-center text-xs text-slate-500">
          Secure payment via Paystack. Entry fee {formatNaira(fee)}.
        </p>
      </div>
    )
  }

  if (view === 'registered') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-emerald-400">✓ You&apos;re registered</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            My Dashboard
          </Link>
          <Link
            href={bracketHref}
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            View Bracket
          </Link>
        </div>
      </div>
    )
  }

  const message =
    view === 'full'
      ? 'This tournament is full.'
      : view === 'ended'
        ? 'This tournament has ended.'
        : 'Registration is closed.'

  return (
    <div className={box}>
      <p className="text-center text-sm font-semibold text-slate-400">{message}</p>
      {view !== 'full' && (
        <Link
          href={bracketHref}
          className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
        >
          View Bracket
        </Link>
      )}
    </div>
  )
}

function RegisterForm({
  tournamentId,
  label,
  prefill,
}: {
  tournamentId: string
  label: string
  prefill: { displayName: string; whatsapp: string }
}) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
      <Field
        name="whatsapp"
        label="WhatsApp number"
        type="tel"
        defaultValue={prefill.whatsapp}
        placeholder="+234…"
      />
      <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
      <Field name="ignTag" label="In-game player ID / tag" placeholder="Your IGN or player tag" />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <SubmitButton label={label} pendingLabel="Redirecting to payment…" />
    </form>
  )
}
```

- [ ] **Step 2: Wire profile prefill into the tournament detail page**

In `app/(public)/tournaments/[slug]/page.tsx`, replace the `existingStatus` block (currently):

```tsx
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
```

with:

```tsx
  let existingStatus: string | null = null
  let prefill = { displayName: '', whatsapp: '' }
  if (user) {
    const [{ data: reg }, { data: profile }] = await Promise.all([
      supabase
        .from('tournament_registrations')
        .select('payment_status')
        .eq('tournament_id', t.id)
        .eq('player_id', user.id)
        .maybeSingle(),
      supabase.from('profiles').select('display_name, whatsapp_number').eq('id', user.id).maybeSingle(),
    ])
    existingStatus = reg?.payment_status ?? null
    prefill = { displayName: profile?.display_name ?? '', whatsapp: profile?.whatsapp_number ?? '' }
  }
```

Then update the `RegistrationPanel` usage:

```tsx
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          loginHref={`/login?next=/tournaments/${t.slug}`}
          prefill={prefill}
        />
```

- [ ] **Step 3: Run the test suite**

Run: `npm run test`
Expected: PASS — no test file covers this component (no component tests in this repo); confirm nothing else regressed.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (the `prefill` prop is now required on both the call site and the component).

- [ ] **Step 5: Commit**

```bash
git add components/tournament/RegistrationPanel.tsx "app/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat: #15 collect display name/WhatsApp/club/IGN at registration"
```

---

### Task 6: Admin registrations list

**Files:**
- Create: `components/admin/PlayerSearch.tsx`
- Create: `components/admin/RegistrationsTable.tsx`
- Create: `app/admin/tournaments/[id]/registrations/page.tsx`
- Modify: `components/admin/TournamentListRow.tsx`

**Interfaces:**
- Consumes: `matchesPlayerQuery` (Task 2), `requireStaff` from `@/lib/admin/auth` (existing).
- Produces: `PlayerSearch({ value, onChange, placeholder? })` — a controlled search input, reused by Tasks 9 and 10. `AdminRegistrationRow` type, consumed only within this task.

- [ ] **Step 1: Create the shared search input**

Create `components/admin/PlayerSearch.tsx`:

```tsx
'use client'

export function PlayerSearch({
  value,
  onChange,
  placeholder = 'Search by username or club name…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
    />
  )
}
```

- [ ] **Step 2: Create the registrations table**

Create `components/admin/RegistrationsTable.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { formatDateTime } from '@/lib/format'

export interface AdminRegistrationRow {
  id: string
  username: string | null
  regDisplayName: string | null
  regWhatsapp: string | null
  regClubName: string | null
  regIgnTag: string | null
  paymentStatus: string
  registeredAt: string
}

export function RegistrationsTable({ rows }: { rows: AdminRegistrationRow[] }) {
  const [query, setQuery] = useState('')
  const filtered = rows.filter((r) =>
    matchesPlayerQuery(
      { username: r.username, displayName: r.regDisplayName, clubName: r.regClubName },
      query,
    ),
  )

  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No registrations match &quot;{query}&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2.5 text-left">Player</th>
                <th className="px-2 py-2.5 text-left">WhatsApp</th>
                <th className="px-2 py-2.5 text-left">Club</th>
                <th className="px-2 py-2.5 text-left">IGN / Tag</th>
                <th className="px-2 py-2.5 text-left">Payment</th>
                <th className="px-3 py-2.5 text-left">Registered</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-white">
                    {r.regDisplayName ?? r.username ?? 'Unknown'}
                  </td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regIgnTag ?? '—'}</td>
                  <td className="px-2 py-2.5 capitalize text-slate-300">{r.paymentStatus}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the admin registrations page**

Create `app/admin/tournaments/[id]/registrations/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationsTable, type AdminRegistrationRow } from '@/components/admin/RegistrationsTable'

export const metadata: Metadata = { title: 'Registrations · Admin · SentinelX' }

type ProfileRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: ProfileRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}

export default async function AdminRegistrationsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const { data } = await supabase
    .from('tournament_registrations')
    .select(
      'id, payment_status, registered_at, reg_display_name, reg_whatsapp, reg_club_name, reg_ign_tag, profiles(username)',
    )
    .eq('tournament_id', t.id)
    .order('registered_at', { ascending: false })

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

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Registrations</h2>
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

- [ ] **Step 4: Add the nav link**

In `components/admin/TournamentListRow.tsx`, add a "Registrations" link next to the existing "Bracket" link:

```tsx
          <Link
            href={`/admin/tournaments/${t.id}/registrations`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Registrations
          </Link>
          <Link
            href={`/admin/tournaments/${t.id}/bracket`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Bracket
          </Link>
```

(Insert the new `Link` immediately before the existing "Bracket" `Link`.)

- [ ] **Step 5: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add components/admin/PlayerSearch.tsx components/admin/RegistrationsTable.tsx "app/admin/tournaments/[id]/registrations/page.tsx" components/admin/TournamentListRow.tsx
git commit -m "feat: #15/#17 admin registrations list with player search"
```

---

### Task 7: League table GF/GA columns

**Files:**
- Modify: `lib/tournaments/standings.ts`
- Modify: `lib/tournaments/standings.test.ts`
- Modify: `components/bracket/StandingsTable.tsx`

**Interfaces:**
- Produces: `MembershipInput` and `StandingRow` gain optional `clubName?: string | null`, passed through unchanged by `sortStandings`. Consumed by Task 9 (`bracket-view.ts` populates it; `AdminBracketView` filters on it).

- [ ] **Step 1: Write the failing test**

Add to `lib/tournaments/standings.test.ts` (append inside the existing `describe('sortStandings', ...)` block, after the last `it`):

```ts
  it('passes clubName through unchanged when present', () => {
    const [row] = sortStandings([
      m({ playerId: 'a', name: 'A', clubName: 'Lagos Ronin', points: 3, goalsFor: 2, goalsAgainst: 0 }),
    ])
    expect(row.clubName).toBe('Lagos Ronin')
  })

  it('leaves clubName undefined when not provided', () => {
    const [row] = sortStandings([m({ playerId: 'a', name: 'A' })])
    expect(row.clubName).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/tournaments/standings.test.ts`
Expected: FAIL — TypeScript error, `clubName` does not exist on type `MembershipInput`.

- [ ] **Step 3: Add the field**

In `lib/tournaments/standings.ts`, add `clubName?: string | null` to both interfaces:

```ts
export interface MembershipInput {
  playerId: string
  name: string
  clubName?: string | null
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

export interface StandingRow {
  playerId: string
  name: string
  clubName?: string | null
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  rank: number
  advancing: boolean
}
```

(`sortStandings`'s body is unchanged — it already spreads `...s`, so `clubName` flows through automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/tournaments/standings.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Add GF/GA columns to the table**

In `components/bracket/StandingsTable.tsx`, add two header cells between `L` and `GD`:

```tsx
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">L</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">GF</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">GA</th>
              <th className="px-2 py-2.5 text-center">GD</th>
```

and two body cells in the same position:

```tsx
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.losses}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.goalsFor}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.goalsAgainst}</td>
                <td className="px-2 py-2.5 text-center text-slate-400">
                  {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
                </td>
```

- [ ] **Step 6: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/standings.ts lib/tournaments/standings.test.ts components/bracket/StandingsTable.tsx
git commit -m "feat: #16 show GF/GA columns on the group-stage league table"
```

---

### Task 8: Leaderboard — 3 tabs (Wins / Sentinel Score / Goals)

**Files:**
- Modify: `lib/rankings/leaderboard.ts`
- Modify: `lib/rankings/leaderboard.test.ts`
- Modify: `components/rankings/LeaderboardTable.tsx`
- Create: `components/rankings/LeaderboardTabs.tsx`
- Modify: `app/(public)/rankings/page.tsx`

**Interfaces:**
- Produces: `type LeaderboardMetric = 'wins' | 'score' | 'goals'`, `rankPlayersBy(players: PlayerStatsInput[], metric: LeaderboardMetric): RankedPlayer[]`. `rankPlayers` keeps its exact existing signature and behavior (now implemented as `rankPlayersBy(players, 'wins')`), so nothing else in the codebase that calls `rankPlayers` needs to change.

- [ ] **Step 1: Write the failing test**

Append to `lib/rankings/leaderboard.test.ts` (after the existing `describe('rankPlayers', ...)` block, before `describe('isRankingEligible', ...)`):

```ts
describe('rankPlayersBy', () => {
  it('sorts by wins when metric is "wins" (matches rankPlayers)', () => {
    const players = [p({ id: 'a', wins: 3 }), p({ id: 'b', wins: 7 })]
    expect(rankPlayersBy(players, 'wins').map((x) => x.id)).toEqual(
      rankPlayers(players).map((x) => x.id),
    )
  })

  it('sorts by Sentinel Score when metric is "score"', () => {
    const r = rankPlayersBy(
      [p({ id: 'a', sentinelScore: 60, wins: 9 }), p({ id: 'b', sentinelScore: 92, wins: 1 })],
      'score',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('sorts by goals scored when metric is "goals"', () => {
    const r = rankPlayersBy(
      [
        p({ id: 'a', goalsScored: 4, wins: 9 }),
        p({ id: 'b', goalsScored: 20, wins: 1 }),
      ],
      'goals',
    )
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('assigns sequential ranks for the chosen metric', () => {
    const r = rankPlayersBy(
      [p({ id: 'a', sentinelScore: 70 }), p({ id: 'b', sentinelScore: 95 }), p({ id: 'c', sentinelScore: 80 })],
      'score',
    )
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/rankings/leaderboard.test.ts`
Expected: FAIL — `rankPlayersBy is not defined`

- [ ] **Step 3: Write the implementation**

Replace the full contents of `lib/rankings/leaderboard.ts`:

```ts
export interface PlayerStatsInput {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  wins: number
  losses: number
  totalMatches: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}

export interface RankedPlayer extends PlayerStatsInput {
  winRate: number
  goalDiff: number
  rank: number
}

// Minimum matches a player must have completed to appear in any ranking or award.
// Value equals the semantic minimum (1 = at least one match) so the constant never
// contradicts its name. Shared by the rankings page and the Hall of Fame.
export const RANKING_MIN_MATCHES = 1

export function isRankingEligible(p: { totalMatches: number }): boolean {
  return p.totalMatches >= RANKING_MIN_MATCHES
}

export type LeaderboardMetric = 'wins' | 'score' | 'goals'

const METRIC_VALUE: Record<LeaderboardMetric, (p: PlayerStatsInput) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  goals: (p) => p.goalsScored,
}

// Sort led by the chosen metric, falling back to the same tie-break cascade
// rankPlayers has always used: wins desc → win rate desc → titles desc →
// goal difference desc. When metric is 'wins', the leading term duplicates
// the first tie-break — harmless, and keeps this the single sort implementation.
export function rankPlayersBy(players: PlayerStatsInput[], metric: LeaderboardMetric): RankedPlayer[] {
  const lead = METRIC_VALUE[metric]
  return players
    .map((pl) => ({
      ...pl,
      winRate: pl.totalMatches > 0 ? pl.wins / pl.totalMatches : 0,
      goalDiff: pl.goalsScored - pl.goalsConceded,
    }))
    .sort(
      (a, b) =>
        lead(b) - lead(a) ||
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        b.totalTitles - a.totalTitles ||
        b.goalDiff - a.goalDiff,
    )
    .map((pl, i) => ({ ...pl, rank: i + 1 }))
}

// Kept for existing callers/tests — identical to rankPlayersBy(players, 'wins').
export function rankPlayers(players: PlayerStatsInput[]): RankedPlayer[] {
  return rankPlayersBy(players, 'wins')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/rankings/leaderboard.test.ts`
Expected: PASS (all existing `rankPlayers`/`isRankingEligible` tests plus the 4 new `rankPlayersBy` tests)

- [ ] **Step 5: Update `LeaderboardTable` to take a `metric` prop**

Replace the full contents of `components/rankings/LeaderboardTable.tsx`:

```tsx
import Link from 'next/link'
import { TierBadge } from '@/components/player/TierBadge'
import type { RankedPlayer, LeaderboardMetric } from '@/lib/rankings/leaderboard'

const METRIC_LABEL: Record<LeaderboardMetric, string> = { wins: 'W', score: 'Score', goals: 'Goals' }
const METRIC_VALUE: Record<LeaderboardMetric, (p: RankedPlayer) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  goals: (p) => p.goalsScored,
}

export function LeaderboardTable({
  players,
  currentUserId,
  metric,
}: {
  players: RankedPlayer[]
  currentUserId: string | null
  metric: LeaderboardMetric
}) {
  const metricValue = METRIC_VALUE[metric]
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="px-2 py-3 text-right">{METRIC_LABEL[metric]}</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-3 py-3 text-right sm:table-cell">GD</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
            const initial = (name[0] ?? '?').toUpperCase()
            return (
              <tr
                key={pl.id}
                className={`border-b border-slate-800/50 transition-colors last:border-0 ${
                  isMe ? 'bg-violet-500/10' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="px-3 py-3.5 font-bold text-slate-400">
                  {pl.rank === 1 ? '🥇' : pl.rank === 2 ? '🥈' : pl.rank === 3 ? '🥉' : `#${pl.rank}`}
                </td>
                <td className="px-2 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight text-white">
                        {pl.username ? (
                          <Link href={`/players/${pl.username}`} className="hover:text-violet-300">
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                        {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                      </p>
                      <TierBadge tier={pl.sentinelTier} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3.5 text-right font-bold text-emerald-400">{metricValue(pl)}</td>
                <td className="px-2 py-3.5 text-right text-slate-300">{Math.round(pl.winRate * 100)}%</td>
                <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">{pl.totalTitles}</td>
                <td className="hidden px-3 py-3.5 text-right font-bold text-white sm:table-cell">
                  {pl.goalDiff > 0 ? `+${pl.goalDiff}` : pl.goalDiff}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Create the tab switcher**

Create `components/rankings/LeaderboardTabs.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'

const TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'Sentinel Score' },
  { key: 'goals', label: 'Goals' },
]

export function LeaderboardTabs({
  players,
  currentUserId,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
}) {
  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  const ranked = rankPlayersBy(players, metric)
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setMetric(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <LeaderboardTable players={ranked} currentUserId={currentUserId} metric={metric} />
    </div>
  )
}
```

- [ ] **Step 7: Update the rankings page**

In `app/(public)/rankings/page.tsx`, replace the `rankPlayers` import and usage. Replace:

```tsx
import { rankPlayers, RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
```

with:

```tsx
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { LeaderboardTabs } from '@/components/rankings/LeaderboardTabs'
```

Remove the old `import { LeaderboardTable } from '@/components/rankings/LeaderboardTable'` line (no longer used directly by this page).

Replace:

```tsx
  const players = rankPlayers(
    (profiles ?? []).map(
      (p): PlayerStatsInput => ({
```

with:

```tsx
  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p): PlayerStatsInput => ({
```

(keep the rest of that object-mapping body unchanged), and close the now-simpler assignment — remove the trailing `),` and `)` that closed the old `rankPlayers(...)` call, replacing with a single closing `)` for the `.map(...)`.

Replace the final render:

```tsx
      {players.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="Rankings coming soon"
          body="Be the first to compete and claim the top spot."
        />
      ) : (
        <LeaderboardTable players={players} currentUserId={user?.id ?? null} />
      )}
```

with:

```tsx
      {players.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="Rankings coming soon"
          body="Be the first to compete and claim the top spot."
        />
      ) : (
        <LeaderboardTabs players={players} currentUserId={user?.id ?? null} />
      )}
```

- [ ] **Step 8: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add lib/rankings/leaderboard.ts lib/rankings/leaderboard.test.ts components/rankings/LeaderboardTable.tsx components/rankings/LeaderboardTabs.tsx "app/(public)/rankings/page.tsx"
git commit -m "feat: #16 platform leaderboard becomes 3 tabs (Wins/Score/Goals)"
```

---

### Task 9: Admin bracket page — club-name join + search

**Files:**
- Modify: `lib/tournaments/bracket-view.ts`
- Create: `components/admin/AdminBracketView.tsx`
- Modify: `app/admin/tournaments/[id]/bracket/page.tsx`

**Interfaces:**
- Consumes: `matchesPlayerQuery` (Task 2), `PlayerSearch` (Task 6), `StandingRow`/`clubName` (Task 7), `BracketView` (existing, `lib/tournaments/bracket-view.ts`).
- Produces: `loadBracketView` now populates `clubName` on each standings row. `AdminBracketView(props: Pick<BracketView, 'standings' | 'fixtures' | 'rounds' | 'hasGroups' | 'hasKnockout'>)` — a client component, consumed only by the admin bracket page.

- [ ] **Step 1: Join club names into `loadBracketView`**

In `lib/tournaments/bracket-view.ts`, add a third parallel query and use it when building standings. Replace:

```ts
  const [membershipsRes, matchesRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select(
            'group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)',
          )
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', tournamentId),
  ])
```

with:

```ts
  const [membershipsRes, matchesRes, regsRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select(
            'group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)',
          )
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', tournamentId),
    supabase.from('tournament_registrations').select('player_id, reg_club_name').eq('tournament_id', tournamentId),
  ])

  const clubNameByPlayer = new Map(
    ((regsRes.data as { player_id: string; reg_club_name: string | null }[] | null) ?? []).map((r) => [
      r.player_id,
      r.reg_club_name,
    ]),
  )
```

Then in the `standings` mapping, add `clubName` to the returned `MembershipInput`. Replace:

```ts
        return {
          playerId: gm.player_id,
          name: nameOf(gm.profiles),
          wins: gm.wins,
          draws: gm.draws,
          losses: gm.losses,
          goalsFor: gm.goals_for,
          goalsAgainst: gm.goals_against,
          points: gm.points,
        }
```

with:

```ts
        return {
          playerId: gm.player_id,
          name: nameOf(gm.profiles),
          clubName: clubNameByPlayer.get(gm.player_id) ?? null,
          wins: gm.wins,
          draws: gm.draws,
          losses: gm.losses,
          goalsFor: gm.goals_for,
          goalsAgainst: gm.goals_against,
          points: gm.points,
        }
```

- [ ] **Step 2: Create the admin bracket search wrapper**

Create `components/admin/AdminBracketView.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

export function AdminBracketView({
  standings,
  fixtures,
  rounds,
  hasGroups,
  hasKnockout,
}: Pick<BracketView, 'standings' | 'fixtures' | 'rounds' | 'hasGroups' | 'hasKnockout'>) {
  const [query, setQuery] = useState('')
  const filteredStandings = standings.map((g) => ({
    groupName: g.groupName,
    rows: g.rows.filter((r) =>
      matchesPlayerQuery({ username: null, displayName: r.name, clubName: r.clubName ?? null }, query),
    ),
  }))

  return (
    <>
      {hasGroups && (
        <PlayerSearch value={query} onChange={setQuery} placeholder="Search players by name or club…" />
      )}
      {hasGroups && <GroupStage standings={filteredStandings} fixtures={fixtures} />}
      {hasKnockout && <KnockoutBracket rounds={rounds} />}
    </>
  )
}
```

- [ ] **Step 3: Wire it into the admin bracket page**

In `app/admin/tournaments/[id]/bracket/page.tsx`, replace the imports:

```tsx
import { BracketActions } from '@/components/admin/BracketActions'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'
```

with:

```tsx
import { BracketActions } from '@/components/admin/BracketActions'
import { AdminBracketView } from '@/components/admin/AdminBracketView'
```

Replace the render block:

```tsx
      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <>
          {view.hasGroups && <GroupStage standings={view.standings} fixtures={view.fixtures} />}
          {view.hasKnockout && <KnockoutBracket rounds={view.rounds} />}
        </>
      )}
```

with:

```tsx
      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <AdminBracketView
          standings={view.standings}
          fixtures={view.fixtures}
          rounds={view.rounds}
          hasGroups={view.hasGroups}
          hasKnockout={view.hasKnockout}
        />
      )}
```

- [ ] **Step 4: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed. (`lib/tournaments/bracket.test.ts` and `lib/tournaments/standings.test.ts` are unaffected by this task's changes — `bracket-view.ts` has no direct unit tests, consistent with how it was before this plan.)

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/bracket-view.ts components/admin/AdminBracketView.tsx "app/admin/tournaments/[id]/bracket/page.tsx"
git commit -m "feat: #17 search players by name/club on the admin bracket page"
```

---

### Task 10: Admin results queue — club-name join + search

**Files:**
- Modify: `lib/matches/review-queue.ts`
- Create: `components/admin/AdminResultsQueue.tsx`
- Modify: `app/admin/results/page.tsx`

**Interfaces:**
- Produces: `ReviewMatchInput` gains optional `playerAClubName?: string | null` / `playerBClubName?: string | null` (unused by `bucketReviewQueue`'s bucketing logic — passthrough only, so `lib/matches/review-queue.test.ts` needs no changes). `AdminResultsQueue({ needsReview, noSubmission, disputed }: { ...ReviewMatchInput[] })` — a client component replacing the inline `Bucket` rendering currently in `app/admin/results/page.tsx`.

- [ ] **Step 1: Extend `ReviewMatchInput`**

In `lib/matches/review-queue.ts`, add the two optional fields:

```ts
export interface ReviewMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  submissionCount: number
  round: string
  playerAName: string
  playerBName: string
  playerAClubName?: string | null
  playerBClubName?: string | null
  tournamentTitle: string
  tournamentSlug: string
}
```

(`bucketReviewQueue`'s body is unchanged.)

- [ ] **Step 2: Run the existing review-queue test to confirm no regression**

Run: `npm run test -- lib/matches/review-queue.test.ts`
Expected: PASS (unchanged — the new fields are optional, so the test file's `m()` helper still builds valid `ReviewMatchInput` objects without them).

- [ ] **Step 3: Create the search-wrapped results queue**

Create `components/admin/AdminResultsQueue.tsx`:

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { ReviewMatchInput } from '@/lib/matches/review-queue'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'

function matchesEitherPlayer(m: ReviewMatchInput, query: string): boolean {
  return (
    matchesPlayerQuery({ username: null, displayName: m.playerAName, clubName: m.playerAClubName ?? null }, query) ||
    matchesPlayerQuery({ username: null, displayName: m.playerBName, clubName: m.playerBClubName ?? null }, query)
  )
}

export function AdminResultsQueue({
  needsReview,
  noSubmission,
  disputed,
}: {
  needsReview: ReviewMatchInput[]
  noSubmission: ReviewMatchInput[]
  disputed: ReviewMatchInput[]
}) {
  const [query, setQuery] = useState('')
  const filtered = {
    needsReview: needsReview.filter((m) => matchesEitherPlayer(m, query)),
    noSubmission: noSubmission.filter((m) => matchesEitherPlayer(m, query)),
    disputed: disputed.filter((m) => matchesEitherPlayer(m, query)),
  }
  const total = filtered.needsReview.length + filtered.noSubmission.length + filtered.disputed.length

  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} />
      {total === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          {query ? `No matches for "${query}".` : 'Nothing to review right now.'}
        </p>
      ) : (
        <div className="space-y-8">
          <Bucket title="Needs review" items={filtered.needsReview} />
          <Bucket title="No submission" items={filtered.noSubmission} />
          <Bucket title="Disputed" items={filtered.disputed} />
        </div>
      )}
    </div>
  )
}

function Bucket({ title, items }: { title: string; items: ReviewMatchInput[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
          >
            <p className="truncate font-bold text-white">
              {m.playerAName} <span className="text-slate-500">vs</span> {m.playerBName}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {m.tournamentTitle} · {m.round.replace(/_/g, ' ')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite the admin results page**

Replace the full contents of `app/admin/results/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'
import { AdminResultsQueue } from '@/components/admin/AdminResultsQueue'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstT(t: TournamentRef): { title: string; slug: string } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function AdminResultsPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, tournament_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed'])

  const rawRows = (data as unknown[] | null) ?? []
  const tournamentIds = Array.from(
    new Set(rawRows.map((raw) => (raw as { tournament_id: string }).tournament_id)),
  )
  const { data: regs } =
    tournamentIds.length > 0
      ? await supabase
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_club_name')
          .in('tournament_id', tournamentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_club_name: string | null }[] }
  const clubByKey = new Map((regs ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_club_name]))

  const rows: ReviewMatchInput[] = rawRows.map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      tournament_id: string
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
      match_results: { count: number }[]
    }
    const t = firstT(m.tournament)
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      playerAClubName: m.player_a?.id ? clubByKey.get(`${m.tournament_id}:${m.player_a.id}`) ?? null : null,
      playerBClubName: m.player_b?.id ? clubByKey.get(`${m.tournament_id}:${m.player_b.id}`) ?? null : null,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const { needsReview, noSubmission, disputed } = bucketReviewQueue(rows, new Date())

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Results to verify</h2>
      <AdminResultsQueue needsReview={needsReview} noSubmission={noSubmission} disputed={disputed} />
    </section>
  )
}
```

- [ ] **Step 5: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/review-queue.ts components/admin/AdminResultsQueue.tsx app/admin/results/page.tsx
git commit -m "feat: #17 search players by name/club on the admin results queue"
```

---

### Task 11: Tournament rules — admin capability

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-schema.test.ts`
- Modify: `lib/tournaments/admin-actions.ts`
- Modify: `components/admin/TournamentForm.tsx`
- Modify: `app/admin/tournaments/[id]/edit/page.tsx`
- Modify: `app/admin/tournaments/new/page.tsx`

**Interfaces:**
- Produces: `tournamentSchema` and `TournamentInput` gain `rules: string` (optional, empty-string-to-null on write). `TournamentFormValues` gains `rules: string`. Consumed by Task 12 (public rendering reads `tournaments.rules` directly from the DB — no new interface needed there).

- [ ] **Step 1: Write the failing test**

Append to `lib/tournaments/admin-schema.test.ts`, inside the existing `valid` object (add the field) and add a new `it`:

Replace the `valid` object:

```ts
const valid = {
  title: 'DLS Cup',
  gameId: '11111111-1111-4111-8111-111111111111',
  slug: '',
  description: '',
  bannerUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '16',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '2026-08-01T18:00',
  tournamentEnd: '',
  rules: '',
}
```

Add a new test inside `describe('tournamentSchema', ...)`:

```ts
  it('accepts a Markdown rules string and leaves it as-is', () => {
    const r = tournamentSchema.safeParse({ ...valid, rules: '**No smurfing.**\n\n- Best of 3' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rules).toBe('**No smurfing.**\n\n- Best of 3')
  })

  it('allows an empty rules field', () => {
    expect(tournamentSchema.safeParse({ ...valid, rules: '' }).success).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/tournaments/admin-schema.test.ts`
Expected: FAIL — `rules` not in the parsed shape / schema rejects the extra unexpected behavior mismatch (the existing `valid` object now includes `rules`, which the current schema doesn't declare — Zod's default is to strip unknown keys, so the first assertion `expect(r.data.rules).toBe(...)` fails because `r.data.rules` is `undefined`).

- [ ] **Step 3: Add the field to the schema**

In `lib/tournaments/admin-schema.ts`, add `rules` to `tournamentSchema` (reusing the existing `optionalText` helper):

```ts
export const tournamentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title is too long'),
  gameId: z.string().uuid('Choose a game'),
  slug: z.union([z.literal(''), z.string().trim().max(120)]),
  description: optionalText(2000),
  bannerUrl: optionalUrl,
  registrationFee: money(1_000_000),
  prizePool: money(1_000_000_000),
  maxPlayers: z.union([
    z.literal(''),
    z.coerce.number().int().min(2, 'At least 2 players').max(64, 'At most 64 players'),
  ]),
  registrationStart: localDateTime,
  registrationEnd: localDateTime,
  tournamentStart: localDateTime,
  tournamentEnd: localDateTime,
  rules: optionalText(5000),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/tournaments/admin-schema.test.ts`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 5: Thread `rules` through the admin actions**

In `lib/tournaments/admin-actions.ts`, add `rules` to `parseForm`:

```ts
function parseForm(formData: FormData) {
  return tournamentSchema.safeParse({
    title: formData.get('title'),
    gameId: formData.get('gameId'),
    slug: formData.get('slug') ?? '',
    description: formData.get('description') ?? '',
    bannerUrl: formData.get('bannerUrl') ?? '',
    registrationFee: formData.get('registrationFee'),
    prizePool: formData.get('prizePool'),
    maxPlayers: formData.get('maxPlayers') ?? '',
    registrationStart: formData.get('registrationStart') ?? '',
    registrationEnd: formData.get('registrationEnd') ?? '',
    tournamentStart: formData.get('tournamentStart') ?? '',
    tournamentEnd: formData.get('tournamentEnd') ?? '',
    rules: formData.get('rules') ?? '',
  })
}
```

and to `toRow`:

```ts
function toRow(d: TournamentInput) {
  const orNull = (v: string) => (v === '' ? null : v)
  return {
    title: d.title,
    game_id: d.gameId,
    description: orNull(d.description),
    banner_url: orNull(d.bannerUrl),
    registration_fee: d.registrationFee,
    prize_pool: d.prizePool,
    max_players: d.maxPlayers === '' ? null : d.maxPlayers,
    registration_start: orNull(d.registrationStart),
    registration_end: orNull(d.registrationEnd),
    tournament_start: orNull(d.tournamentStart),
    tournament_end: orNull(d.tournamentEnd),
    rules: orNull(d.rules),
  }
}
```

- [ ] **Step 6: Add the textarea to `TournamentForm`**

In `components/admin/TournamentForm.tsx`, add `rules: string` to the `TournamentFormValues` interface:

```ts
export interface TournamentFormValues {
  id?: string
  title: string
  slug: string
  gameId: string
  description: string
  bannerUrl: string
  registrationFee: string
  prizePool: string
  maxPlayers: string
  registrationStart: string
  registrationEnd: string
  tournamentStart: string
  tournamentEnd: string
  rules: string
}
```

Add a rules textarea immediately after the Description field (after the `</div>` that closes the description block, before the `Field label="Banner URL"` line):

```tsx
      <div className="space-y-1.5">
        <label htmlFor="rules" className="text-sm font-medium text-slate-300">
          Rules
        </label>
        <textarea
          id="rules"
          name="rules"
          defaultValue={initial.rules}
          rows={8}
          placeholder={'Markdown supported: **bold**, - lists, [links](https://...)'}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500">
          Shown to players above the register button. Leave blank to skip the rules step entirely.
        </p>
      </div>
```

- [ ] **Step 7: Thread `rules` through both admin pages' initial values**

In `app/admin/tournaments/[id]/edit/page.tsx`, add `rules: t.rules ?? ''` to the `initial` object:

```tsx
  const initial: TournamentFormValues = {
    id: t.id,
    title: t.title,
    slug: t.slug,
    gameId: t.game_id,
    description: t.description ?? '',
    bannerUrl: t.banner_url ?? '',
    registrationFee: moneyStr(t.registration_fee),
    prizePool: moneyStr(t.prize_pool),
    maxPlayers: t.max_players == null ? '' : String(t.max_players),
    registrationStart: toLocalInput(t.registration_start),
    registrationEnd: toLocalInput(t.registration_end),
    tournamentStart: toLocalInput(t.tournament_start),
    tournamentEnd: toLocalInput(t.tournament_end),
    rules: t.rules ?? '',
  }
```

Also update this file's `supabase.from('tournaments').select('*')` — it already selects `*`, so `t.rules` is available with no query change.

In `app/admin/tournaments/new/page.tsx`, add `rules: ''` to `EMPTY`:

```ts
const EMPTY: TournamentFormValues = {
  title: '',
  slug: '',
  gameId: '',
  description: '',
  bannerUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '',
  tournamentEnd: '',
  rules: '',
}
```

- [ ] **Step 8: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-schema.test.ts lib/tournaments/admin-actions.ts components/admin/TournamentForm.tsx "app/admin/tournaments/[id]/edit/page.tsx" app/admin/tournaments/new/page.tsx
git commit -m "feat: #18 admin can set tournament rules (Markdown)"
```

---

### Task 12: Tournament rules — public rendering + registration checkbox

**Files:**
- Modify: `package.json` (add `react-markdown`)
- Modify: `app/(public)/tournaments/[slug]/page.tsx`
- Modify: `components/tournament/RegistrationPanel.tsx`

**Interfaces:**
- Consumes: `tournaments.rules` (Task 1/11), the server-side rules gate already live in `registerForTournament` since Task 4.
- Produces: `RegistrationPanel` and `RegisterForm` gain a `hasRules: boolean` prop (second, expected modification of this file — see Task 5's note).

- [ ] **Step 1: Install the dependency**

Run: `npm install react-markdown`
Expected: `package.json` and `package-lock.json` gain `react-markdown` under `dependencies`.

- [ ] **Step 2: Render the rules block on the tournament detail page**

In `app/(public)/tournaments/[slug]/page.tsx`, add the import:

```tsx
import ReactMarkdown from 'react-markdown'
```

Add `rules` to the `getTournament` select:

```tsx
    .select(
      'id, title, slug, description, banner_url, prize_pool, registration_fee, status, format, max_players, registration_end, tournament_start, rules, games(name, icon_url, slug)',
    )
```

Insert the rules block immediately before `<div className="mb-6"><RegistrationPanel ...`:

```tsx
      {t.rules && (
        <div className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 text-sm leading-relaxed text-slate-300 [&_a]:text-violet-400 [&_a]:underline [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5">
          <h2 className="mb-2 text-base font-bold text-white">Tournament Rules</h2>
          <ReactMarkdown>{t.rules}</ReactMarkdown>
        </div>
      )}

      <div className="mb-6">
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          loginHref={`/login?next=/tournaments/${t.slug}`}
          prefill={prefill}
          hasRules={!!t.rules}
        />
      </div>
```

- [ ] **Step 3: Add the checkbox to `RegisterForm`**

In `components/tournament/RegistrationPanel.tsx`, add `hasRules: boolean` to `RegistrationPanel`'s props:

```tsx
export function RegistrationPanel({
  view,
  tournamentId,
  slug,
  fee,
  loginHref,
  prefill,
  hasRules,
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
}) {
```

Pass it into both `RegisterForm` call sites (inside the `can_register`/`complete_payment` branch):

```tsx
        <RegisterForm
          tournamentId={tournamentId}
          prefill={prefill}
          hasRules={hasRules}
          label={
            view === 'complete_payment' ? 'Complete payment →' : `Register — ${formatNaira(fee)}`
          }
        />
```

Update `RegisterForm` itself:

```tsx
function RegisterForm({
  tournamentId,
  label,
  prefill,
  hasRules,
}: {
  tournamentId: string
  label: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
}) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
      <Field
        name="whatsapp"
        label="WhatsApp number"
        type="tel"
        defaultValue={prefill.whatsapp}
        placeholder="+234…"
      />
      <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
      <Field name="ignTag" label="In-game player ID / tag" placeholder="Your IGN or player tag" />
      {hasRules && (
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" name="agreedToRules" value="true" required className="mt-0.5 accent-violet-600" />
          <span>I have read and agree to the tournament rules.</span>
        </label>
      )}
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <SubmitButton label={label} pendingLabel="Redirecting to payment…" />
    </form>
  )
}
```

The checkbox's native `required` attribute blocks form submission in-browser until checked (standard HTML validation — no extra client state needed); `registerForTournament` (Task 4) independently re-checks `agreedToRules === 'true'` server-side whenever `tournament.rules` is non-empty, so a request that bypasses the browser (e.g. a direct POST) is still rejected.

- [ ] **Step 4: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json "app/(public)/tournaments/[slug]/page.tsx" components/tournament/RegistrationPanel.tsx
git commit -m "feat: #18 render tournament rules + require agreement to register"
```

---

### Task 13: Registration deadline countdown

**Files:**
- Create: `lib/tournaments/countdown.ts`
- Test: `lib/tournaments/countdown.test.ts`
- Create: `components/tournament/RegistrationCountdown.tsx`
- Modify: `app/(public)/tournaments/[slug]/page.tsx`

**Interfaces:**
- Produces: `countdownTo(deadline: Date, now: Date): { closed: boolean; days: number; hours: number; minutes: number; seconds: number }` — pure, consumed by `RegistrationCountdown`.

- [ ] **Step 1: Write the failing test**

Create `lib/tournaments/countdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countdownTo } from './countdown'

describe('countdownTo', () => {
  it('breaks down a future deadline into days/hours/minutes/seconds', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-14T03:04:05Z') // +2d 3h 4m 5s
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 2, hours: 3, minutes: 4, seconds: 5 })
  })

  it('reports closed at the exact deadline', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    expect(countdownTo(now, now)).toEqual({ closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('reports closed after the deadline has passed', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-11T00:00:00Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('rolls seconds correctly under a minute', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-12T00:00:45Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 0, hours: 0, minutes: 0, seconds: 45 })
  })

  it('handles a deadline under an hour away', () => {
    const now = new Date('2026-07-12T00:00:00Z')
    const deadline = new Date('2026-07-12T00:42:30Z')
    expect(countdownTo(deadline, now)).toEqual({ closed: false, days: 0, hours: 0, minutes: 42, seconds: 30 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/tournaments/countdown.test.ts`
Expected: FAIL — `Cannot find module './countdown'`

- [ ] **Step 3: Write the implementation**

Create `lib/tournaments/countdown.ts`:

```ts
export interface CountdownParts {
  closed: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

// Whole-unit breakdown of the time remaining until `deadline`, floored to zero
// once passed. `now` is injected for deterministic tests.
export function countdownTo(deadline: Date, now: Date): CountdownParts {
  const msRemaining = deadline.getTime() - now.getTime()
  if (msRemaining <= 0) return { closed: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  const totalSeconds = Math.floor(msRemaining / 1000)
  return {
    closed: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/tournaments/countdown.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Create the client countdown component**

Create `components/tournament/RegistrationCountdown.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { countdownTo } from '@/lib/tournaments/countdown'

export function RegistrationCountdown({ registrationEnd }: { registrationEnd: string | null }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Server render (and the pre-mount client render) show nothing rather than a
  // guessed value — avoids a hydration mismatch between server and client clocks.
  if (!registrationEnd || !now) return null

  const parts = countdownTo(new Date(registrationEnd), now)
  if (parts.closed) {
    return <p className="mb-4 text-sm font-bold text-slate-400">Registration closed.</p>
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <p className="mb-4 text-sm font-bold text-violet-400">
      ⏳ Registration closes in {parts.days > 0 && `${parts.days}d `}
      {pad(parts.hours)}h {pad(parts.minutes)}m {pad(parts.seconds)}s
    </p>
  )
}
```

- [ ] **Step 6: Wire it into the tournament detail page**

In `app/(public)/tournaments/[slug]/page.tsx`, add the import:

```tsx
import { RegistrationCountdown } from '@/components/tournament/RegistrationCountdown'
```

Add the component above `RegistrationPanel`, gated to the statuses where it's meaningful, and remove the now-redundant static "Registration closes" line from the date row below.

Replace:

```tsx
      <div className="mb-6">
        <RegistrationPanel
```

with:

```tsx
      <div className="mb-6">
        {(t.status === 'registration_open' || t.status === 'registration_closed') && (
          <RegistrationCountdown registrationEnd={t.registration_end} />
        )}
        <RegistrationPanel
```

Replace:

```tsx
      {(start || regEnd) && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-400">
          {start && <span>🗓️ Starts {start}</span>}
          {regEnd && t.status === 'registration_open' && (
            <span className="text-violet-400/80">⏳ Registration closes {regEnd}</span>
          )}
        </div>
      )}
```

with:

```tsx
      {start && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-400">
          <span>🗓️ Starts {start}</span>
        </div>
      )}
```

Remove the now-unused `regEnd` local variable (`const regEnd = formatDate(t.registration_end)`).

- [ ] **Step 7: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add lib/tournaments/countdown.ts lib/tournaments/countdown.test.ts components/tournament/RegistrationCountdown.tsx "app/(public)/tournaments/[slug]/page.tsx"
git commit -m "feat: #20 live registration-deadline countdown"
```

---

### Task 14: Fixture schedule polish — round label

**Files:**
- Modify: `lib/tournaments/bracket.ts`
- Modify: `components/dashboard/FixtureCard.tsx`

**Interfaces:**
- Consumes: `ROUND_LABELS` (existing, extended here), `DashboardFixture.round` (existing, already populated — see `lib/dashboard/fixtures.ts` / `app/dashboard/page.tsx`, no changes needed there).

No new pure logic — `ROUND_LABELS` already has a test-free precedent (no `it()` in `lib/tournaments/bracket.test.ts` references it), and this task only adds one map entry plus a display-string change. Skipped straight to implementation; verified in the final manual pass.

- [ ] **Step 1: Add the "group" label**

In `lib/tournaments/bracket.ts`, add a `group` entry to `ROUND_LABELS`:

```ts
export const ROUND_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-finals',
  semi_final: 'Semi-finals',
  final: 'Final',
}
```

- [ ] **Step 2: Show the round on each fixture card**

In `components/dashboard/FixtureCard.tsx`, add the import:

```tsx
import { ROUND_LABELS } from '@/lib/tournaments/bracket'
```

Replace the subtitle line:

```tsx
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fixture.tournamentTitle} · {formatDateTime(fixture.scheduledAt) ?? 'Time TBD'}
          </p>
```

with:

```tsx
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fixture.tournamentTitle} · {ROUND_LABELS[fixture.round] ?? fixture.round} ·{' '}
            {formatDateTime(fixture.scheduledAt) ?? 'Time TBD'}
          </p>
```

- [ ] **Step 3: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/bracket.ts components/dashboard/FixtureCard.tsx
git commit -m "feat: #19 show round label on dashboard fixture cards"
```

---

### Task 15: Full verification + ROADMAP update

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:** none — this is the integration checkpoint.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — every test file in the repo, including all new/modified ones from Tasks 1–14.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: succeeds with no TypeScript or Next.js errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable only if they pre-exist elsewhere in the repo — do not introduce new ones).

- [ ] **Step 4: Manual walkthrough (use the `verify` skill if available; otherwise drive it directly)**

Using a local dev server (`npm run dev`) against a Supabase project with migration 015 applied:

1. Register for an open tournament: confirm the 4 new fields are required, WhatsApp/display-name prefill from the logged-in profile, and (once Task 11's rules textarea has content saved via `/admin/tournaments/[id]/edit`) the rules block renders as Markdown and the agreement checkbox blocks submission until checked.
2. As staff, open `/admin/tournaments/[id]/registrations`: confirm the 4 fields display and the search box filters by username/club name.
3. Open `/admin/tournaments/[id]/bracket` and `/admin/results`: confirm the search box filters players/matches by name or club.
4. Open a tournament with group standings: confirm GF/GA columns appear on desktop widths.
5. Open `/rankings`: confirm the 3 tabs re-sort correctly (Wins / Sentinel Score / Goals).
6. Open `/dashboard`: confirm fixture cards show the round label.
7. Open a tournament detail page with a future `registration_end`: confirm the countdown ticks live and flips to "Registration closed." once passed (or when viewing an already-closed tournament).

- [ ] **Step 5: Update ROADMAP.md**

Renumber the existing v4.0 entry and add the new v3.5 section. Replace:

```markdown
## v4.0 — Scale

| # | Task | Status |
|---|------|--------|
| 15 | Multi-game support + team/school/state leagues | ⬜ |
```

with:

```markdown
## v3.5 — Admin gap fixes

| # | Task | Status |
|---|------|--------|
| 15 | Registration fields (display name, WhatsApp, club, IGN tag) + admin registrations list | ✅ |
| 16 | League table GF/GA columns + 3-tab platform leaderboard (Wins/Score/Goals) | ✅ |
| 17 | Admin player search (registrations, bracket, results) | ✅ |
| 18 | Tournament rules (Markdown) + registration agreement checkbox | ✅ |
| 19 | Dashboard fixture schedule — round label polish | ✅ |
| 20 | Live registration-deadline countdown | ✅ |

**★ v3.5 COMPLETE (#15–#20).** Six admin-flagged gaps closed: registration now
captures per-tournament player details verified by Samuel; league tables show
full goal splits; the leaderboard ranks by three separate metrics; admin search
works across registrations, brackets, and results; tournaments can carry
Markdown rules gated by a registration checkbox; and tournament pages show a
live countdown to the registration deadline.

## v4.0 — Scale

| # | Task | Status |
|---|------|--------|
| 21 | Multi-game support + team/school/state leagues | ⬜ |
```

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark #15-#20 admin gap fixes complete"
```

---

## Self-Review

**Spec coverage:**
- #15 (registration fields + admin verification) → Tasks 1, 3, 4, 5, 6. ✅
- #16 (league table + leaderboard) → Tasks 7, 8. ✅
- #17 (admin search) → Tasks 2, 6, 9, 10. ✅
- #18 (rules + agreement checkbox) → Tasks 1, 4, 11, 12. ✅
- #19 (fixture schedule polish) → Task 14. ✅
- #20 (countdown) → Task 13. ✅
- Migration + types foundation → Task 1. ✅
- ROADMAP renumbering (#15 multi-game → #21) → Task 15. ✅

**Placeholder scan:** no TBD/TODO markers; every step shows complete code, not descriptions of code.

**Type consistency check:**
- `RegistrationPanel` / `RegisterForm` prop names (`prefill`, `hasRules`) are identical across Task 5 (introduces `prefill`) and Task 12 (adds `hasRules` to the same two components) — confirmed both tasks show the full, final signature at each point so an implementer reading Task 12 alone still sees `prefill` already present.
- `registrationDetailsSchema` field names (`displayName`, `whatsapp`, `clubName`, `ignTag`) match exactly between Task 3 (schema), Task 4 (`formData.get(...)` keys in the action), and Task 5 (`Field name="..."` in the form).
- `matchesPlayerQuery`'s parameter shape (`{ username, displayName, clubName? }`) is used identically in Tasks 6, 9, and 10.
- `AdminRegistrationRow`, `ReviewMatchInput`, `MembershipInput`/`StandingRow`, and `BracketView` field names are consistent between their producing task and every consuming task.
- `LeaderboardMetric`/`rankPlayersBy`/`METRIC_VALUE` keys (`'wins' | 'score' | 'goals'`) match across Task 8's `leaderboard.ts`, `LeaderboardTable.tsx`, and `LeaderboardTabs.tsx`.

No gaps found.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-12-admin-gap-fixes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
