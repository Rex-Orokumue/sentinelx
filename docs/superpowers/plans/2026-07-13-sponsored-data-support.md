# Sponsored Data Support (#29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can configure a per-tournament "data support" perk (free text + WhatsApp number); semi-finalists/finalists see a "Claim Data Support" button on their dashboard that opens WhatsApp with a pre-filled claim message.

**Architecture:** Two nullable columns on `tournaments`. Eligibility is computed from the player's existing `matches` rows (no new tracking) via one new pure function, mirroring how `lib/dashboard/fixtures.ts` already computes fixture state from raw match rows. The claim button reuses the existing `toWhatsAppNumber`/`wa.me` pattern.

**Tech Stack:** Next.js 14 Server Components, Supabase, Zod, Vitest.

## Global Constraints

- Both new tournament columns are nullable; a tournament with either unset never shows the claim button to anyone (spec §2).
- Eligibility = a `matches` row exists with `round IN ('semi_final', 'final')` for that player in that tournament — row existence alone, regardless of match status or outcome (spec §3).
- `stage` is `'final'` whenever a `final`-round row exists for that player, even if a `semi_final`-round row also exists (finalists reached the semifinal too, but the message names the furthest stage) (spec §4).
- No claim/delivery tracking of any kind — the button is a plain outbound `wa.me` link; nothing is written to the database on click (spec §5).
- No admin UI to see who has claimed — out of scope (spec §5).

---

## File Structure

**New:**
- `supabase/migrations/025_tournament_data_support.sql`
- `lib/dashboard/data-support.ts` — pure eligibility + URL-building
- `lib/dashboard/data-support.test.ts`
- `components/dashboard/DataSupportPanel.tsx`

**Modified:**
- `lib/tournaments/admin-schema.ts`
- `lib/tournaments/admin-actions.ts`
- `components/admin/TournamentForm.tsx`
- `app/admin/tournaments/new/page.tsx`
- `app/admin/tournaments/[id]/edit/page.tsx`
- `app/dashboard/page.tsx`
- `lib/supabase/types.ts` — regenerated

---

### Task 1: Migration — `tournaments.data_support_text` / `data_support_whatsapp`

**Files:**
- Create: `supabase/migrations/025_tournament_data_support.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 025_tournament_data_support.sql — #29 sponsored data support perk.
ALTER TABLE public.tournaments
  ADD COLUMN data_support_text     text,
  ADD COLUMN data_support_whatsapp text;
```

- [ ] **Step 2: Apply and regenerate types**

Run: `npx supabase db push`
Run: `npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts`

Expected: `tournaments`'s `Row`/`Insert`/`Update` types gain `data_support_text: string | null` and `data_support_whatsapp: string | null`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_tournament_data_support.sql lib/supabase/types.ts
git commit -m "feat: #29 tournaments.data_support_text/data_support_whatsapp columns"
```

---

### Task 2: Admin schema + actions — accept the two new fields

**Files:**
- Modify: `lib/tournaments/admin-schema.ts`
- Modify: `lib/tournaments/admin-actions.ts`

**Interfaces:**
- Produces: `tournamentSchema` gains `dataSupportText: string`, `dataSupportWhatsapp: string` (both optional-text, same shape as `description`/`rules`).

- [ ] **Step 1: Extend `lib/tournaments/admin-schema.ts`**

Change:
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
to:
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
  dataSupportText: optionalText(500),
  dataSupportWhatsapp: optionalText(20),
})
```

- [ ] **Step 2: Run the existing schema test**

Run: `npx vitest run lib/tournaments/admin-schema.test.ts`
Expected: still passes — the new fields are optional, so every existing valid input in that test file remains valid.

- [ ] **Step 3: Wire the two fields through `lib/tournaments/admin-actions.ts`**

Change `parseForm`:
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
to:
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
    dataSupportText: formData.get('dataSupportText') ?? '',
    dataSupportWhatsapp: formData.get('dataSupportWhatsapp') ?? '',
  })
}
```

Change `toRow`:
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
to:
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
    data_support_text: orNull(d.dataSupportText),
    data_support_whatsapp: orNull(d.dataSupportWhatsapp),
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments/admin-schema.ts lib/tournaments/admin-actions.ts
git commit -m "feat: #29 accept data support text/WhatsApp on the tournament admin form actions"
```

---

### Task 3: Admin form UI — `TournamentForm`, new/edit pages

**Files:**
- Modify: `components/admin/TournamentForm.tsx`
- Modify: `app/admin/tournaments/new/page.tsx`
- Modify: `app/admin/tournaments/[id]/edit/page.tsx`

- [ ] **Step 1: Extend `TournamentFormValues` and add the two fields to the form**

Change:
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
to:
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
  dataSupportText: string
  dataSupportWhatsapp: string
}
```

Add fields right after the "Rules" `<textarea>` block and before "Banner URL":
```tsx
      <div className="space-y-1.5">
        <label htmlFor="dataSupportText" className="text-sm font-medium text-slate-300">
          Data support perk <span className="text-slate-500">(optional)</span>
        </label>
        <textarea
          id="dataSupportText"
          name="dataSupportText"
          defaultValue={initial.dataSupportText}
          rows={2}
          placeholder="e.g. 1GB data for semi-finalists, 2GB for finalists"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      <Field
        label="Data support WhatsApp number"
        name="dataSupportWhatsapp"
        defaultValue={initial.dataSupportWhatsapp}
      />
```

(Insert directly above the existing `<Field label="Banner URL" ...>` line.)

- [ ] **Step 2: Update `app/admin/tournaments/new/page.tsx`**

Change:
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
to:
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
  dataSupportText: '',
  dataSupportWhatsapp: '',
}
```

- [ ] **Step 3: Update `app/admin/tournaments/[id]/edit/page.tsx`**

Change:
```ts
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
to:
```ts
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
    dataSupportText: t.data_support_text ?? '',
    dataSupportWhatsapp: t.data_support_whatsapp ?? '',
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/TournamentForm.tsx app/admin/tournaments/new/page.tsx "app/admin/tournaments/[id]/edit/page.tsx"
git commit -m "feat: #29 data support fields on the admin tournament create/edit form"
```

---

### Task 4: Pure eligibility + claim-URL helpers — `lib/dashboard/data-support.ts`

**Files:**
- Create: `lib/dashboard/data-support.ts`
- Create: `lib/dashboard/data-support.test.ts`

**Interfaces:**
- Produces:
  - `export interface DataSupportMatch { round: string; tournamentId: string; tournamentTitle: string; dataSupportText: string | null; dataSupportWhatsapp: string | null }`
  - `export interface DataSupportEligibility { tournamentId: string; tournamentTitle: string; text: string; whatsapp: string; stage: 'semi-final' | 'final' }`
  - `export function computeDataSupportEligibility(matches: DataSupportMatch[]): DataSupportEligibility[]`
  - `export function buildDataSupportClaimUrl(args: { whatsapp: string; username: string; tournamentTitle: string; stage: 'semi-final' | 'final' }): string | null`
- Consumes: `toWhatsAppNumber` from `lib/dashboard/fixtures.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { computeDataSupportEligibility, buildDataSupportClaimUrl, type DataSupportMatch } from './data-support'

describe('computeDataSupportEligibility', () => {
  it('returns nothing when no round is semi_final/final', () => {
    const matches: DataSupportMatch[] = [
      { round: 'quarter_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([])
  })

  it('returns nothing when the tournament has no data support configured', () => {
    const matches: DataSupportMatch[] = [
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: null, dataSupportWhatsapp: null },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([])
  })

  it('marks a semi_final row as stage semi-final', () => {
    const matches: DataSupportMatch[] = [
      { round: 'semi_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup', text: '1GB', whatsapp: '0801', stage: 'semi-final' },
    ])
  })

  it('prefers final over semi_final when both rows exist for the same tournament', () => {
    const matches: DataSupportMatch[] = [
      { round: 'semi_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup', text: '1GB', whatsapp: '0801', stage: 'final' },
    ])
  })

  it('returns one row per eligible tournament when a player is eligible in more than one', () => {
    const matches: DataSupportMatch[] = [
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup 1', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
      { round: 'semi_final', tournamentId: 't2', tournamentTitle: 'Cup 2', dataSupportText: '2GB', dataSupportWhatsapp: '0802' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup 1', text: '1GB', whatsapp: '0801', stage: 'final' },
      { tournamentId: 't2', tournamentTitle: 'Cup 2', text: '2GB', whatsapp: '0802', stage: 'semi-final' },
    ])
  })
})

describe('buildDataSupportClaimUrl', () => {
  it('builds the exact pre-filled wa.me message', () => {
    const url = buildDataSupportClaimUrl({
      whatsapp: '08012345678',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      stage: 'final',
    })
    expect(url).toBe(
      'https://wa.me/2348012345678?text=' +
        encodeURIComponent("Hi, I'm chidi and I reached the final of DLS Cup 4. I'd like to claim my data support."),
    )
  })

  it('returns null for an unparseable WhatsApp number', () => {
    const url = buildDataSupportClaimUrl({
      whatsapp: 'not-a-number',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      stage: 'semi-final',
    })
    expect(url).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/data-support.test.ts`
Expected: FAIL — `./data-support` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { toWhatsAppNumber } from './fixtures'

export interface DataSupportMatch {
  round: string
  tournamentId: string
  tournamentTitle: string
  dataSupportText: string | null
  dataSupportWhatsapp: string | null
}

export interface DataSupportEligibility {
  tournamentId: string
  tournamentTitle: string
  text: string
  whatsapp: string
  stage: 'semi-final' | 'final'
}

// One row per tournament the player is eligible in — 'final' wins over
// 'semi-final' when both rounds exist for the same tournament (a finalist
// reached the semifinal too, but the claim message names the furthest stage).
export function computeDataSupportEligibility(matches: DataSupportMatch[]): DataSupportEligibility[] {
  const byTournament = new Map<string, DataSupportEligibility>()

  for (const m of matches) {
    if (m.round !== 'semi_final' && m.round !== 'final') continue
    if (!m.dataSupportText || !m.dataSupportWhatsapp) continue

    const stage: 'semi-final' | 'final' = m.round === 'final' ? 'final' : 'semi-final'
    const existing = byTournament.get(m.tournamentId)
    if (existing && existing.stage === 'final') continue // already at the furthest stage

    byTournament.set(m.tournamentId, {
      tournamentId: m.tournamentId,
      tournamentTitle: m.tournamentTitle,
      text: m.dataSupportText,
      whatsapp: m.dataSupportWhatsapp,
      stage,
    })
  }

  return Array.from(byTournament.values())
}

export function buildDataSupportClaimUrl(args: {
  whatsapp: string
  username: string
  tournamentTitle: string
  stage: 'semi-final' | 'final'
}): string | null {
  const number = toWhatsAppNumber(args.whatsapp)
  if (!number) return null
  const text = `Hi, I'm ${args.username} and I reached the ${args.stage} of ${args.tournamentTitle}. I'd like to claim my data support.`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/data-support.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/data-support.ts lib/dashboard/data-support.test.ts
git commit -m "feat: #29 pure data-support eligibility + wa.me claim-URL builder, TDD"
```

---

### Task 5: Dashboard — `DataSupportPanel`, wiring

**Files:**
- Create: `components/dashboard/DataSupportPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `computeDataSupportEligibility`, `buildDataSupportClaimUrl`, `DataSupportEligibility` from Task 4.

- [ ] **Step 1: Write `components/dashboard/DataSupportPanel.tsx`**

```tsx
import { buildDataSupportClaimUrl } from '@/lib/dashboard/data-support'
import type { DataSupportEligibility } from '@/lib/dashboard/data-support'

export function DataSupportPanel({
  username,
  eligibility,
}: {
  username: string
  eligibility: DataSupportEligibility[]
}) {
  if (eligibility.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Data support</h2>
      <div className="space-y-2">
        {eligibility.map((e) => {
          const url = buildDataSupportClaimUrl({
            whatsapp: e.whatsapp,
            username,
            tournamentTitle: e.tournamentTitle,
            stage: e.stage,
          })
          return (
            <div key={e.tournamentId} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="font-bold text-white">{e.tournamentTitle}</p>
              <p className="mt-1 text-xs text-slate-400">{e.text}</p>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-5 py-2.5 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
                >
                  Claim Data Support
                </a>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Wire into `app/dashboard/page.tsx`**

The dashboard's existing `matches` query (`matchesRes`) already selects `round` and joins `tournament:tournaments(title, slug)` for every match the player is in — extend that join to also carry the two new columns and the tournament id, then derive eligibility from the same `rawMatches` array already being mapped for fixtures.

Change the `matchesRes` query's select string:
```ts
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, tournament_id, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
```
to:
```ts
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, tournament_id, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug, data_support_text, data_support_whatsapp)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
```

Update the `TournamentRef` type and `rawMatches` shape near the top of the file:
```ts
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null
```
to:
```ts
type TournamentRef =
  | { title: string; slug: string; data_support_text: string | null; data_support_whatsapp: string | null }
  | { title: string; slug: string; data_support_text: string | null; data_support_whatsapp: string | null }[]
  | null
```

`firstTournament` already returns `{ title, slug } | null` from a `TournamentRef` — since `TournamentRef`'s object shape now carries two more fields, widen its return type too:
```ts
function firstTournament(t: TournamentRef): { title: string; slug: string } | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}
```
to:
```ts
function firstTournament(
  t: TournamentRef,
): { title: string; slug: string; data_support_text: string | null; data_support_whatsapp: string | null } | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}
```

Add the import:
```ts
import { computeDataSupportEligibility } from '@/lib/dashboard/data-support'
import { DataSupportPanel } from '@/components/dashboard/DataSupportPanel'
```

Right after the existing `rawMatches` typed array (which now includes the widened `tournament: TournamentRef`), add the eligibility computation — place it directly after the `matches`/`fixtures` derivation block:
```ts
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())

  const dataSupportEligibility = computeDataSupportEligibility(
    rawMatches.map((mm) => {
      const t = firstTournament(mm.tournament)
      return {
        round: mm.round,
        tournamentId: mm.tournament_id,
        tournamentTitle: t?.title ?? 'Tournament',
        dataSupportText: t?.data_support_text ?? null,
        dataSupportWhatsapp: t?.data_support_whatsapp ?? null,
      }
    }),
  )
```

Render it in the JSX, right after `<ReferralPanel .../>` (order doesn't matter functionally — placing it near the top keeps claimable perks visible without scrolling past every other section):
```tsx
      <ReferralPanel username={profile?.username ?? ''} referredPlayers={referredPlayers} />
      <DataSupportPanel username={profile?.username ?? ''} eligibility={dataSupportEligibility} />
      <FriendsPanel incoming={incomingRequests} friends={friendsList} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/DataSupportPanel.tsx app/dashboard/page.tsx
git commit -m "feat: #29 dashboard Claim Data Support panel for semi-finalists/finalists"
```

---

### Task 6: Manual verification

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 7 new `data-support.test.ts` cases.

- [ ] **Step 2: Manual walkthrough** (`npm run dev`, QA test accounts)

1. As staff, edit a tournament with the new "Data support perk" text and WhatsApp number filled in; save; reload the edit page — both values persist.
2. As a player who has not reached the semifinal in that tournament, load `/dashboard` — no "Data support" section renders.
3. As a player who has reached the semifinal (a `semi_final`-round match row exists for them), load `/dashboard` — the section renders with the tournament title, the configured text, and a "Claim Data Support" button; click it and confirm it opens WhatsApp with the exact "Hi, I'm `<username>` and I reached the semi-final of `<title>`. I'd like to claim my data support." message pre-filled.
4. For a finalist in a tournament where they also have a semifinal row, confirm the message says "final", not "semi-final".
5. Leave a tournament's data support WhatsApp number blank — confirm no claim button (and no section, if that's the player's only eligible tournament) renders for that tournament.

- [ ] **Step 2: Report results**

If any step fails, treat it as a bug against the task that owns the broken code path.
