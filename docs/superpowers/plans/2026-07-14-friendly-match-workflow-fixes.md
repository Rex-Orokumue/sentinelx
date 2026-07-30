# Friendly Match Workflow Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a batch of friend/friendly-match UX and correctness issues found in live use: the player directory shows your own account and a stale "Add friend" button even when already friends; the challenge flow forces a separate WhatsApp round-trip just to share a game code; the result-submission screen gives no guidance and no save confirmation; the screenshot storage is broken (private bucket + public URL); only one player's submission was enough for admin to confirm a result; and the completed-match screen is a dead end with no win/loss framing or share option.

**Architecture:** Reuses the tournament-match system's already-working pattern for "both sides must submit" — a separate per-submitter results table (`match_results` → new `friendly_match_results`) plus signed URLs for a private storage bucket (exactly how `app/admin/matches/[id]/review/page.tsx` already handles `match-evidence`). No new architecture is invented; the friendly-match system is brought in line with the pattern the tournament-match system already uses successfully.

**Tech Stack:** Next.js 14.2.35 App Router (Server Components, Server Actions), Supabase (Postgres + RLS + Storage), TypeScript, Tailwind, Vitest.

## Global Constraints

- This codebase's test convention: unit tests with TDD only for pure functions in `lib/`; Server Actions, Next.js pages, and React components have no test files.
- Every Supabase query goes through the RLS-scoped client (`lib/supabase/server`/`lib/supabase/client`), never `createAdminClient`, except inside existing admin-only actions/pages that already use it (signed URL generation, wallet credit, sentinel score writes).
- All Supabase clients in this codebase are generically typed against `Database` from `lib/supabase/types.ts` (`createServerClient<Database>`, `createBrowserClient<Database>`) — any new table or dropped column MUST be reflected in `lib/supabase/types.ts` by hand (no live CLI access assumed), or `tsc --noEmit` will fail on `.from('friendly_match_results')` and any reference to the dropped `screenshot_url` column.
- Storage bucket `friendly-match-evidence` is **private** (`public: false`, set in migration 023) — always store the storage **path** in a screenshot column, never `getPublicUrl()`'s result, and always render it via a server-generated `createSignedUrl(path, 3600)` (mirroring `app/admin/matches/[id]/review/page.tsx:58-60` and `app/(public)/matches/[id]/page.tsx:96-99`).
- Mirror the tournament-match reference patterns exactly where named below: `lib/matches/verify.ts`'s `prefillScore`, `components/admin/ResultReviewForms.tsx`'s `ScoreField`, and the WhatsApp share link format `https://wa.me/?text=${encodeURIComponent(shareText)}` used in `app/(public)/matches/[id]/page.tsx:192-199`.
- Line numbers cited below reflect each file's state as read during planning (2026-07-14) — `Read` the current file before each `Edit` and match by surrounding code, not by line number alone.

---

### Task 1: `/players` excludes the viewer's own profile

**Files:**
- Modify: `app/(public)/players/page.tsx`

- [ ] **Step 1: Exclude the logged-in viewer from the results**

Current file queries `profiles` with no viewer awareness. Add a viewer lookup and exclude their own row:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { PlayerCard, type PlayerCardData } from '@/components/player/PlayerCard'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Players · SentinelX Esports',
  description: 'Browse and search Sentinel X players by username or name.',
  openGraph: {
    title: 'Players · SentinelX Esports',
    description: 'Browse and search Sentinel X players by username or name.',
    url: `${SITE_URL}/players`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

const PLAYER_COLS = 'username, display_name, avatar_url, sentinel_score, sentinel_tier'

export default async function PlayersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim()
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let query = supabase
    .from('profiles')
    .select(PLAYER_COLS)
    .order('sentinel_score', { ascending: false })
    .limit(60)
  if (user) query = query.neq('id', user.id)
  if (q) {
    // Escape ilike wildcards ("%"/"_") plus the characters that are
    // structural to PostgREST's `.or()` filter-list syntax (",", "(", ")")
    // so they can't widen the match or break/inject into the filter string.
    const escaped = q.replace(/[%_,()]/g, (c) => `\\${c}`)
    query = query.or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
  }
  const { data } = await query
  const players = (data ?? []) as PlayerCardData[]

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Players</h1>
      <form action="/players" className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by username or name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </form>
      {players.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No players found.
        </p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <PlayerCard key={p.username} player={p} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/players/page.tsx"
git commit -m "fix: exclude the viewer's own profile from the /players directory"
```

---

### Task 2: Player profile shows "Friends"/"Request sent" instead of always offering Add Friend

**Files:**
- Modify: `lib/friends/list.ts`
- Modify: `lib/friends/list.test.ts`
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`

**Interfaces:**
- Produces: `FriendshipStatus` type (`'none' | 'pending_sent' | 'pending_received' | 'friends'`), `friendshipStatus(rows, viewerId, otherId): FriendshipStatus` — consumed by `ProfileHeader`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `lib/friends/list.test.ts`:

```typescript
describe('friendshipStatus', () => {
  it('is "none" when no row exists', () => {
    expect(friendshipStatus([], 'me', 'you')).toBe('none')
  })
  it('is "friends" when accepted, requester direction', () => {
    expect(friendshipStatus([row({ requesterId: 'me', recipientId: 'you' })], 'me', 'you')).toBe('friends')
  })
  it('is "friends" when accepted, recipient direction', () => {
    expect(friendshipStatus([row({ requesterId: 'you', recipientId: 'me' })], 'me', 'you')).toBe('friends')
  })
  it('is "pending_sent" when viewer is the requester of a pending row', () => {
    expect(
      friendshipStatus([row({ requesterId: 'me', recipientId: 'you', status: 'pending' })], 'me', 'you'),
    ).toBe('pending_sent')
  })
  it('is "pending_received" when viewer is the recipient of a pending row', () => {
    expect(
      friendshipStatus([row({ requesterId: 'you', recipientId: 'me', status: 'pending' })], 'me', 'you'),
    ).toBe('pending_received')
  })
})
```

And update the import line at the top of `lib/friends/list.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isFriendsWith, sortFriendsFirst, friendshipStatus, type FriendshipRow } from './list'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/friends/list.test.ts`
Expected: FAIL — `friendshipStatus is not exported`

- [ ] **Step 3: Write the implementation**

Add to `lib/friends/list.ts` (after the existing `sortFriendsFirst`):

```typescript
export type FriendshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'friends'

export function friendshipStatus(rows: FriendshipRow[], viewerId: string, otherId: string): FriendshipStatus {
  const row = rows.find(
    (r) =>
      (r.requesterId === viewerId && r.recipientId === otherId) ||
      (r.requesterId === otherId && r.recipientId === viewerId),
  )
  if (!row) return 'none'
  if (row.status === 'accepted') return 'friends'
  return row.requesterId === viewerId ? 'pending_sent' : 'pending_received'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/friends/list.test.ts`
Expected: PASS (11 tests — 6 existing + 5 new)

- [ ] **Step 5: Render the correct state in `ProfileHeader`**

Read the current `components/player/ProfileHeader.tsx` first. Replace the unconditional `AddFriendButton` block with a status-aware render. Full replacement of the file:

```tsx
import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'
import type { FriendshipStatus } from '@/lib/friends/list'

export function ProfileHeader({
  profile,
  viewerId,
  friendshipStatus,
}: {
  profile: ProfileView
  viewerId: string | null
  friendshipStatus: FriendshipStatus
}) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  return (
    <header className="flex flex-col items-center gap-3 py-8 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
      <Avatar
        avatarUrl={profile.avatarUrl}
        displayName={profile.displayName}
        username={profile.username}
        size={72}
        className="text-2xl"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="text-sm text-slate-400">
          @{profile.username}
          {profile.country ? ` · ${profile.country}` : ''}
          {since ? ` · since ${since}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <span className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-bold text-white">
            {profile.sentinelScore}
            <span className="text-slate-500">/100</span>
          </span>
          <TierBadge tier={profile.sentinelTier} />
          <span className="text-sm font-semibold text-violet-400">
            {profile.rank != null ? `Ranked #${profile.rank}` : 'Unranked'}
          </span>
        </div>
        {profile.bio && <p className="mt-3 whitespace-pre-line text-sm text-slate-300">{profile.bio}</p>}
        {viewerId && viewerId !== profile.id && (
          <div className="mt-3 space-y-2">
            <FriendStatusAction status={friendshipStatus} profileId={profile.id} />
            <ChallengeButton opponentId={profile.id} />
          </div>
        )}
      </div>
    </header>
  )
}

function FriendStatusAction({ status, profileId }: { status: FriendshipStatus; profileId: string }) {
  if (status === 'friends') {
    return <p className="text-sm font-semibold text-emerald-400">✓ Friends</p>
  }
  if (status === 'pending_sent') {
    return <p className="text-sm text-slate-400">Friend request sent</p>
  }
  if (status === 'pending_received') {
    return <p className="text-sm text-slate-400">They sent you a friend request — check your dashboard</p>
  }
  return <AddFriendButton recipientId={profileId} />
}
```

- [ ] **Step 6: Compute and pass the status from the profile page**

Read the current `app/(public)/players/[username]/page.tsx` first. It already fetches `user` via `supabase.auth.getUser()` before rendering `<ProfileHeader profile={profile} viewerId={user?.id ?? null} />`. Add a `friends` lookup and pass the computed status:

```typescript
import { friendshipStatus, type FriendshipStatus } from '@/lib/friends/list'
```

Immediately after the existing `const { data: { user } } = await supabase.auth.getUser()` call (inside `PlayerProfilePage`, before the parallel `Promise.all`), add:

```typescript
  let friendship: FriendshipStatus = 'none'
  if (user && user.id !== p.id) {
    const { data: friendRow } = await supabase
      .from('friends')
      .select('requester_id, recipient_id, status')
      .or(`and(requester_id.eq.${user.id},recipient_id.eq.${p.id}),and(requester_id.eq.${p.id},recipient_id.eq.${user.id})`)
      .maybeSingle()
    if (friendRow) {
      friendship = friendshipStatus(
        [{ requesterId: friendRow.requester_id, recipientId: friendRow.recipient_id, status: friendRow.status }],
        user.id,
        p.id,
      )
    }
  }
```

Update the `<ProfileHeader />` call:

```tsx
<ProfileHeader profile={profile} viewerId={user?.id ?? null} friendshipStatus={friendship} />
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: no errors, full suite passes (371 tests — 360 + 11 new)

- [ ] **Step 8: Commit**

```bash
git add lib/friends/list.ts lib/friends/list.test.ts components/player/ProfileHeader.tsx "app/(public)/players/[username]/page.tsx"
git commit -m "fix: profile page shows Friends/Request sent instead of always offering Add Friend"
```

---

### Task 3: Game code settable at challenge time

**Files:**
- Modify: `lib/friendly-matches/schema.ts`
- Modify: `lib/friendly-matches/actions.ts`
- Modify: `components/player/ChallengeButton.tsx`

- [ ] **Step 1: Add `gameCode` to the challenge schema**

```typescript
import { z } from 'zod'

export const challengeSchema = z.object({
  opponentId: z.string().uuid(),
  stakeAmount: z.union([
    z.literal(''),
    z.coerce.number().int().min(100, 'Minimum stake is ₦100'),
  ]),
  gameCode: z.union([z.literal(''), z.string().trim().max(100)]),
})

export type ChallengeInput = z.infer<typeof challengeSchema>
```

- [ ] **Step 2: Accept and store it in `sendChallenge`**

In `lib/friendly-matches/actions.ts`, update the `safeParse` call and the insert:

```typescript
  const parsed = challengeSchema.safeParse({
    opponentId: formData.get('opponentId') ?? '',
    stakeAmount: formData.get('stakeAmount') ?? '',
    gameCode: formData.get('gameCode') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === parsed.data.opponentId) return { error: "You can't challenge yourself." }

  const stakeAmount = parsed.data.stakeAmount === '' ? null : parsed.data.stakeAmount
  const gameCode = parsed.data.gameCode === '' ? null : parsed.data.gameCode

  const { data: created, error } = await supabase
    .from('friendly_matches')
    .insert({
      challenger_id: user.id,
      opponent_id: parsed.data.opponentId,
      stake_amount: stakeAmount,
      game_code: gameCode,
      status: 'pending',
    })
    .select('id')
    .single()
```

(the rest of `sendChallenge` — the `notifyInApp` call and `revalidatePath`/return — is unchanged)

- [ ] **Step 3: Add the input to `ChallengeButton`**

Read the current `components/player/ChallengeButton.tsx` first. Add a game-code input inside the form, before the stake checkbox row:

```tsx
      <input
        name="gameCode"
        type="text"
        maxLength={100}
        placeholder="Game code (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/friendly-matches/schema.ts lib/friendly-matches/actions.ts components/player/ChallengeButton.tsx
git commit -m "feat: let the challenger set a game code when sending a friendly challenge"
```

---

### Task 4: Friendly match result flow overhaul

**Files:**
- Create: `supabase/migrations/026_friendly_match_results.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `lib/friendly-matches/result-actions.ts`
- Modify: `lib/friendly-matches/admin-actions.ts`
- Modify: `components/friendly/MatchRoom.tsx`
- Modify: `app/dashboard/friendlies/[id]/page.tsx`
- Modify: `app/admin/friendlies/page.tsx`
- Modify: `components/admin/FriendlyQueueRow.tsx`

**Interfaces:**
- Consumes: `prefillScore` (`lib/matches/verify.ts`), `friendlyMatchEventsFor` (`lib/friendly-matches/scoring.ts`, unchanged signature), `creditWallet` (`lib/wallet/service.ts`, unchanged).
- Produces: `friendly_match_results` table (one row per submitter). `MatchRoom` gains `mySubmitted: boolean` and `isWinner: boolean` props.

This task fixes five things in one pass because they all touch the same submission/review pipeline: (a) the screenshot storage bug (private bucket + `getPublicUrl()` mismatch — "storage bucket not found"), (b) "only one person submitted and the match moved on" (now requires both), (c) missing upload guidance text, (d) missing save confirmation for the game code, (e) the dry completed screen (now shows win/loss + a WhatsApp share button).

- [ ] **Step 1: Write the migration**

```sql
-- Friendly match results — mirrors public.match_results: one row per
-- submitter, so a friendly match only reaches admin review once BOTH
-- the challenger and opponent have independently submitted their result.
-- Screenshot storage stores the PATH (not a public URL) — the bucket is
-- private, so the URL is generated fresh via createSignedUrl at render
-- time, exactly like match-evidence in app/admin/matches/[id]/review.
CREATE TABLE public.friendly_match_results (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  friendly_match_id uuid        NOT NULL REFERENCES public.friendly_matches(id) ON DELETE CASCADE,
  submitted_by      uuid        NOT NULL REFERENCES public.profiles(id),
  score_challenger  integer     NOT NULL,
  score_opponent    integer     NOT NULL,
  screenshot_url    text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (friendly_match_id, submitted_by)
);
CREATE INDEX ON public.friendly_match_results (friendly_match_id);
CREATE INDEX ON public.friendly_match_results (submitted_by);

ALTER TABLE public.friendly_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fmr_participant_or_staff_select" ON public.friendly_match_results
  FOR SELECT USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND auth.uid() IN (fm.challenger_id, fm.opponent_id)
    )
  );

-- A participant can only insert/update their OWN row, and only while the
-- match is still 'active' — once both sides have submitted (status moves
-- to awaiting_admin_confirmation) neither can add or edit a submission.
CREATE POLICY "fmr_participant_insert_while_active" ON public.friendly_match_results
  FOR INSERT WITH CHECK (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND fm.status = 'active'
        AND auth.uid() IN (fm.challenger_id, fm.opponent_id)
    )
  );
CREATE POLICY "fmr_own_update_while_active" ON public.friendly_match_results
  FOR UPDATE USING (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.friendly_matches fm
      WHERE fm.id = friendly_match_id AND fm.status = 'active'
    )
  );

-- friendly_matches.screenshot_url is superseded by per-submission
-- screenshots in friendly_match_results — drop the now-dead column.
ALTER TABLE public.friendly_matches DROP COLUMN screenshot_url;
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `--yes`. If the CLI is unreachable, fall back to `mcp__claude_ai_Supabase__apply_migration` with explicit user confirmation (show the exact SQL first). If migration-history bookkeeping is out of sync afterward, repair via `supabase migration repair` or `execute_sql`.

- [ ] **Step 3: Hand-patch `lib/supabase/types.ts`**

No live CLI/credentials assumed in this environment — patch by hand instead of regenerating.

In the `friendly_matches` entry (`Row`/`Insert`/`Update` blocks), delete the `screenshot_url: string | null` (Row) and `screenshot_url?: string | null` (Insert, Update) lines — three deletions total, one per block.

Immediately after the `friendly_matches` entry's closing `}` (right before the `friends: {` entry), insert:

```typescript
      friendly_match_results: {
        Row: {
          created_at: string
          friendly_match_id: string
          id: string
          score_challenger: number
          score_opponent: number
          screenshot_url: string
          submitted_by: string
        }
        Insert: {
          created_at?: string
          friendly_match_id: string
          id?: string
          score_challenger: number
          score_opponent: number
          screenshot_url: string
          submitted_by: string
        }
        Update: {
          created_at?: string
          friendly_match_id?: string
          id?: string
          score_challenger?: number
          score_opponent?: number
          screenshot_url?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendly_match_results_friendly_match_id_fkey"
            columns: ["friendly_match_id"]
            isOneToOne: false
            referencedRelation: "friendly_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendly_match_results_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 4: Rewrite `submitFriendlyResult`**

Full replacement of `lib/friendly-matches/result-actions.ts`:

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { friendlyResultSchema } from './result-schema'
import type { FriendlyActionState } from './actions'

export async function submitFriendlyResult(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!id) return { error: 'Missing match.' }
  if (!screenshotPath) return { error: 'A screenshot is required.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A friendly match cannot end in a draw.' }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this match can submit a result.' }
  }
  if (fm.status !== 'active') return { error: 'This match is not active.' }

  const { error } = await supabase.from('friendly_match_results').upsert(
    {
      friendly_match_id: id,
      submitted_by: user.id,
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      screenshot_url: screenshotPath,
    },
    { onConflict: 'friendly_match_id,submitted_by' },
  )
  if (error) return { error: 'Could not submit your result. Please try again.' }

  const { count } = await supabase
    .from('friendly_match_results')
    .select('id', { count: 'exact', head: true })
    .eq('friendly_match_id', id)
  if ((count ?? 0) >= 2) {
    await supabase.from('friendly_matches').update({ status: 'awaiting_admin_confirmation' }).eq('id', id)
  }

  revalidatePath(`/dashboard/friendlies/${id}`)
  return { success: true }
}
```

- [ ] **Step 5: Rewrite `confirmFriendlyResult`, keep `disputeFriendlyResult`**

Read the current `lib/friendly-matches/admin-actions.ts` first (only `confirmFriendlyResult` changes; `disputeFriendlyResult` is untouched). Replace `confirmFriendlyResult` with:

```typescript
import { friendlyResultSchema } from './result-schema'

export async function confirmFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A friendly match cannot end in a draw.' }
  }

  const admin = createAdminClient()
  const { data: fm } = await admin
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (fm.status !== 'awaiting_admin_confirmation') return { error: 'This match is not awaiting confirmation.' }

  const winnerId = parsed.data.scoreChallenger > parsed.data.scoreOpponent ? fm.challenger_id : fm.opponent_id

  const { error } = await admin
    .from('friendly_matches')
    .update({
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      winner_id: winnerId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not confirm the result. Please try again.' }

  // Staked friendlies only — Sentinel Score events + balance eligibility.
  if (fm.stake_amount) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: parsed.data.scoreChallenger,
      scoreOpponent: parsed.data.scoreOpponent,
      winnerId,
    })
    await admin.from('sentinel_score_events').insert(events)

    for (const playerId of [fm.challenger_id, fm.opponent_id]) {
      const { data: scoreEvents } = await admin
        .from('sentinel_score_events')
        .select('points_delta')
        .eq('player_id', playerId)
      await admin
        .from('profiles')
        .update({ sentinel_score: computeScore(scoreEvents ?? []) })
        .eq('id', playerId)
    }

    await creditWallet(admin, winnerId, fm.stake_amount * 2, 'friendly_stake', fm.id)
  }

  for (const playerId of [fm.challenger_id, fm.opponent_id]) {
    await notifyInApp({
      playerId,
      type: 'result_confirmed',
      title: 'Friendly match confirmed',
      body:
        playerId === winnerId
          ? 'You won your friendly match — confirmed by admin.'
          : 'Your friendly match result was confirmed by admin.',
      link: `/dashboard/friendlies/${fm.id}`,
    })
  }

  revalidatePath('/admin/friendlies')
  revalidatePath('/dashboard')
  return { success: true }
}
```

Add the `friendlyResultSchema` import at the top of the file alongside the existing imports.

- [ ] **Step 6: Rewrite `MatchRoom.tsx`**

Full replacement:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { payStake, type PayStakeState } from '@/lib/friendly-matches/pay-actions'
import { submitFriendlyResult } from '@/lib/friendly-matches/result-actions'
import { acceptChallenge, declineChallenge, type FriendlyActionState } from '@/lib/friendly-matches/actions'
import { createClient } from '@/lib/supabase/client'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export function MatchRoom({
  matchId,
  status,
  stakeAmount,
  isChallenger,
  challengerPaid,
  opponentPaid,
  gameCode,
  opponentWhatsappUrl,
  scoreChallenger,
  scoreOpponent,
  mySubmitted,
  isWinner,
}: {
  matchId: string
  status: string
  stakeAmount: number | null
  isChallenger: boolean
  challengerPaid: boolean
  opponentPaid: boolean
  gameCode: string | null
  opponentWhatsappUrl: string | null
  scoreChallenger: number | null
  scoreOpponent: number | null
  mySubmitted: boolean
  isWinner: boolean
}) {
  const myPaid = isChallenger ? challengerPaid : opponentPaid
  const [payState, payAction] = useFormState<PayStakeState, FormData>(payStake, undefined)

  if (status === 'pending') {
    return <PendingChallenge matchId={matchId} isChallenger={isChallenger} />
  }

  if (status === 'awaiting_payment') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="mb-3 text-sm text-slate-300">
          Both players must pay ₦{stakeAmount} to unlock the Match Room.
        </p>
        {myPaid ? (
          <p className="text-sm font-semibold text-emerald-400">You&apos;ve paid — waiting on your opponent.</p>
        ) : (
          <form action={payAction}>
            <input type="hidden" name="id" value={matchId} />
            <button type="submit" className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
              Pay ₦{stakeAmount}
            </button>
            {payState?.error && <p className="mt-2 text-xs text-red-400">{payState.error}</p>}
          </form>
        )}
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          {opponentWhatsappUrl ? (
            <a
              href={opponentWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] hover:bg-[#25D366]/10"
            >
              Coordinate on WhatsApp
            </a>
          ) : (
            <p className="text-xs text-slate-500">Your opponent hasn&apos;t added a WhatsApp number yet.</p>
          )}
          <GameCodeField matchId={matchId} isChallenger={isChallenger} initialCode={gameCode} />
        </div>
        {mySubmitted ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center text-sm text-slate-300">
            You&apos;ve submitted your result — waiting on your opponent to submit theirs.
          </p>
        ) : (
          <ResultForm matchId={matchId} />
        )}
      </div>
    )
  }

  if (status === 'awaiting_admin_confirmation') {
    return (
      <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm text-amber-300">
        Result submitted — waiting on admin confirmation.
      </p>
    )
  }

  if (status === 'completed') {
    const shareText = `I ${isWinner ? 'won' : 'played'} my friendly match ${scoreChallenger}–${scoreOpponent} on Sentinel X 🎮 ${SITE_URL}`
    return (
      <div className="space-y-4 text-center">
        <div className={`rounded-2xl border p-6 ${isWinner ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-800 bg-slate-900'}`}>
          <p className={`text-2xl font-black ${isWinner ? 'text-emerald-400' : 'text-white'}`}>
            {isWinner ? '🏆 You Won!' : 'You Lost'}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Final score: {scoreChallenger}–{scoreOpponent}
          </p>
        </div>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Share on WhatsApp
        </a>
      </div>
    )
  }

  return <p className="text-sm text-slate-500">This match is {status}.</p>
}

function PendingChallenge({ matchId, isChallenger }: { matchId: string; isChallenger: boolean }) {
  const [acceptState, acceptAction] = useFormState<FriendlyActionState, FormData>(acceptChallenge, undefined)
  const [declineState, declineAction] = useFormState<FriendlyActionState, FormData>(declineChallenge, undefined)

  if (isChallenger) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center text-sm text-slate-300">
        Waiting for your opponent to respond to the challenge.
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
      <p className="text-sm text-slate-300">You&apos;ve been challenged to a friendly match.</p>
      <div className="flex justify-center gap-3">
        <form action={acceptAction}>
          <input type="hidden" name="id" value={matchId} />
          <button type="submit" className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
            Accept
          </button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="id" value={matchId} />
          <button type="submit" className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500">
            Decline
          </button>
        </form>
      </div>
      {(acceptState?.error || declineState?.error) && (
        <p className="text-xs text-red-400">{acceptState?.error || declineState?.error}</p>
      )}
    </div>
  )
}

function GameCodeField({
  matchId,
  isChallenger,
  initialCode,
}: {
  matchId: string
  isChallenger: boolean
  initialCode: string | null
}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!isChallenger) {
    return (
      <p className="mt-3 text-sm text-slate-300">
        Game code: <span className="font-bold text-white">{code || 'not set yet'}</span>
      </p>
    )
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    const supabase = createClient()
    const { error } = await supabase.from('friendly_matches').update({ game_code: code }).eq('id', matchId)
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Drop your in-game code"
        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-xs font-semibold text-emerald-400">Saved!</span>}
    </div>
  )
}

function ResultForm({ matchId }: { matchId: string }) {
  const [state, action] = useFormState<FriendlyActionState, FormData>(submitFriendlyResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [screenshotPath, setScreenshotPath] = useState('')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('friendly-match-evidence').upload(path, file)
    if (!error) setScreenshotPath(path)
    setUploading(false)
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={matchId} />
      <input type="hidden" name="screenshotPath" value={screenshotPath} />
      <p className="text-sm font-bold text-white">Submit the result</p>
      <div className="flex gap-3">
        <input name="scoreChallenger" type="number" min={0} placeholder="Your score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
        <input name="scoreOpponent" type="number" min={0} placeholder="Opponent score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>
      <p className="text-xs text-slate-400">
        Upload a clear screenshot of the final score/result screen from your game — this is what the admin will review to confirm the result.
      </p>
      <input type="file" accept="image/*" onChange={onFile} className="text-xs text-slate-400" />
      {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={uploading || !screenshotPath}
        className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        Submit result
      </button>
    </form>
  )
}
```

- [ ] **Step 7: Wire `mySubmitted`/`isWinner` from the Match Room page**

Read the current `app/dashboard/friendlies/[id]/page.tsx` first (it already fetches `friendly_matches` and computes `isChallenger`, `me`, `opponent`, `opponentWhatsappUrl`). Add, right after the existing `if (user.id !== data.challenger_id && user.id !== data.opponent_id) notFound()` guard:

```typescript
  const { data: myResultRow } = await supabase
    .from('friendly_match_results')
    .select('id')
    .eq('friendly_match_id', params.id)
    .eq('submitted_by', user.id)
    .maybeSingle()
  const mySubmitted = !!myResultRow
  const isWinner = data.winner_id === user.id
```

Update the `<MatchRoom />` call to add the two new props:

```tsx
      <MatchRoom
        matchId={data.id}
        status={data.status}
        stakeAmount={data.stake_amount}
        isChallenger={isChallenger}
        challengerPaid={data.challenger_paid}
        opponentPaid={data.opponent_paid}
        gameCode={data.game_code}
        opponentWhatsappUrl={opponentWhatsappUrl}
        scoreChallenger={data.score_challenger}
        scoreOpponent={data.score_opponent}
        mySubmitted={mySubmitted}
        isWinner={isWinner}
      />
```

Note the page's existing `.select(...)` for `friendly_matches` does not include `screenshot_url` — no change needed there since that column no longer exists after Step 1's migration.

- [ ] **Step 8: Rewrite the admin friendlies queue page**

Full replacement of `app/admin/friendlies/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { prefillScore } from '@/lib/matches/verify'
import { FriendlyQueueRow, type PendingFriendlyMatch } from '@/components/admin/FriendlyQueueRow'

export const metadata: Metadata = { title: 'Friendlies · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'Player'
}

export default async function AdminFriendliesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('friendly_matches')
    .select(
      'id, stake_amount, challenger_id, opponent_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .eq('status', 'awaiting_admin_confirmation')
    .order('created_at', { ascending: true })

  const matches = ((data as unknown[] | null) ?? []) as {
    id: string
    stake_amount: number | null
    challenger_id: string
    opponent_id: string
    challenger: ProfileRef
    opponent: ProfileRef
  }[]

  const admin = createAdminClient()
  const queue: PendingFriendlyMatch[] = await Promise.all(
    matches.map(async (m) => {
      const { data: subs } = await supabase
        .from('friendly_match_results')
        .select('submitted_by, score_challenger, score_opponent, screenshot_url')
        .eq('friendly_match_id', m.id)
        .order('created_at')
      const submissions = (subs ?? []) as {
        submitted_by: string
        score_challenger: number
        score_opponent: number
        screenshot_url: string
      }[]
      const withUrls = await Promise.all(
        submissions.map(async (s) => {
          const { data: signed } = await admin.storage
            .from('friendly-match-evidence')
            .createSignedUrl(s.screenshot_url, 3600)
          return {
            submittedBy: s.submitted_by === m.challenger_id ? ('challenger' as const) : ('opponent' as const),
            scoreChallenger: s.score_challenger,
            scoreOpponent: s.score_opponent,
            signedUrl: signed?.signedUrl ?? null,
          }
        }),
      )
      const s0 = submissions[0] ? { scoreA: submissions[0].score_challenger, scoreB: submissions[0].score_opponent } : null
      const s1 = submissions[1] ? { scoreA: submissions[1].score_challenger, scoreB: submissions[1].score_opponent } : null
      const prefill = prefillScore(s0, s1)
      return {
        id: m.id,
        challengerName: nameOf(m.challenger),
        opponentName: nameOf(m.opponent),
        stakeAmount: m.stake_amount,
        submissions: withUrls,
        prefillScoreChallenger: prefill?.scoreA ?? null,
        prefillScoreOpponent: prefill?.scoreB ?? null,
      }
    }),
  )

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Friendlies — awaiting confirmation</h2>
      {queue.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          Nothing awaiting confirmation.
        </p>
      ) : (
        <div className="space-y-2">
          {queue.map((req) => (
            <FriendlyQueueRow key={req.id} req={req} />
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 9: Rewrite `FriendlyQueueRow` to show both submissions and let admin confirm an official score**

Full replacement of `components/admin/FriendlyQueueRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { confirmFriendlyResult, disputeFriendlyResult, type FriendlyAdminState } from '@/lib/friendly-matches/admin-actions'
import { formatNaira } from '@/lib/format'

export interface FriendlySubmission {
  submittedBy: 'challenger' | 'opponent'
  scoreChallenger: number
  scoreOpponent: number
  signedUrl: string | null
}

export interface PendingFriendlyMatch {
  id: string
  challengerName: string
  opponentName: string
  stakeAmount: number | null
  submissions: FriendlySubmission[]
  prefillScoreChallenger: number | null
  prefillScoreOpponent: number | null
}

export function FriendlyQueueRow({ req }: { req: PendingFriendlyMatch }) {
  const [confirmState, confirmAction] = useFormState<FriendlyAdminState, FormData>(confirmFriendlyResult, undefined)
  const [disputeState, disputeAction] = useFormState<FriendlyAdminState, FormData>(disputeFriendlyResult, undefined)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">
          {req.challengerName} <span className="text-slate-500">vs</span> {req.opponentName}
        </p>
        {req.stakeAmount && <p className="shrink-0 text-sm font-semibold text-violet-400">{formatNaira(req.stakeAmount)} stake</p>}
      </div>

      <div className="mt-2 space-y-2">
        {req.submissions.map((s) => (
          <div key={s.submittedBy} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
            <p className="font-semibold text-white">
              {s.submittedBy === 'challenger' ? req.challengerName : req.opponentName} reported {s.scoreChallenger}–{s.scoreOpponent}
            </p>
            {s.signedUrl && (
              <a href={s.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-400 hover:text-violet-300">
                View screenshot →
              </a>
            )}
          </div>
        ))}
      </div>

      <form action={disputeAction} className="mt-3">
        <input type="hidden" name="id" value={req.id} />
        <textarea
          name="note"
          rows={2}
          placeholder="Dispute reason (required to dispute)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          className="mt-2 rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Dispute
        </button>
      </form>

      <form action={confirmAction} className="mt-3 space-y-2">
        <input type="hidden" name="id" value={req.id} />
        <div className="flex items-end gap-3">
          <ScoreField label={req.challengerName} name="scoreChallenger" defaultValue={req.prefillScoreChallenger ?? undefined} />
          <span className="pb-2 text-slate-500">–</span>
          <ScoreField label={req.opponentName} name="scoreOpponent" defaultValue={req.prefillScoreOpponent ?? undefined} />
        </div>
        <button type="submit" className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
          Confirm official result
        </button>
      </form>

      {(confirmState?.error || disputeState?.error) && (
        <p className="mt-2 text-sm text-red-400">{confirmState?.error || disputeState?.error}</p>
      )}
    </div>
  )
}

function ScoreField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: number }) {
  return (
    <div className="flex-1 space-y-1.5">
      <label className="block truncate text-xs font-medium text-slate-400">{label}</label>
      <input
        name={name}
        type="number"
        min={0}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: no errors, full suite passes, production build succeeds

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/026_friendly_match_results.sql lib/supabase/types.ts lib/friendly-matches/result-actions.ts lib/friendly-matches/admin-actions.ts components/friendly/MatchRoom.tsx "app/dashboard/friendlies/[id]/page.tsx" app/admin/friendlies/page.tsx components/admin/FriendlyQueueRow.tsx
git commit -m "fix: friendly matches require both sides to submit, fix screenshot storage, add win/loss + share screen"
```
