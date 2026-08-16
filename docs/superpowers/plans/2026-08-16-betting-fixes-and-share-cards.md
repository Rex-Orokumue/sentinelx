# Wager Window Fix, Money-Betting Removal, Share-Card Avatar Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the coin-wager window bug that blocks wagering on full-day scheduled matches, remove the real-money betting feature entirely (coins-only going forward), and fix two distinct bugs that drop the sharer's avatar from generated share cards.

**Architecture:** Three independent root-cause fixes, investigated via superpowers:systematic-debugging with live-DB/live-site evidence (not guesses):

1. **Wager window bug** — `wagerWindowOpen()` (`lib/wagers/market.ts`) has no full-day-match carve-out, unlike its money-betting counterpart `bettingOpen()`. Every currently-live scheduled match in production is full-day (`is_full_day=true`), with `scheduled_at` set to midnight WAT (start of the play day). `wagerWindowOpen` computes its close time as `scheduled_at − 15min`, which for these matches is already in the past the moment "today" begins — so wagering reads as closed on a match that hasn't been played. Confirmed live via `execute_sql` against the production DB.
2. **Money betting removal** — `match_bets` has zero rows in production (confirmed via `execute_sql`) — safe to remove the whole feature (UI, actions, admin tooling, nav links, DB table/column) with no data-loss risk. Coin wagering (`lib/wagers/*`) is untouched and becomes the only betting mechanism.
3. **Share-card avatar bugs** — two distinct, unrelated root causes, both confirmed by fetching real generated cards from the live site:
   - **Bypass bug:** `generateMetadata()` in `app/(public)/community/[postId]/page.tsx` sets an explicit `image` override to the post's raw uploaded photo whenever one exists, which per Next.js metadata resolution overrides the file-convention `opengraph-image.tsx` route entirely — so the branded card (with the author's avatar) never renders for any post that has an image. Confirmed: fetched a real image-post's page HTML, its `og:image` meta tag pointed directly at the raw `community-images` file, not the branded card route.
   - **Decoder bug:** even on the branded-card path, `resolveAvatarDataUri()` fetches the *original* uploaded image, and some real avatars are huge (6.2MB in one confirmed case) phone-camera PNGs carrying large embedded EXIF/ICC profile blocks — Satori's PNG decoder silently fails on these (renders a blank circle, no error). Confirmed: downloaded a real failing avatar, inspected it (1792×2392, embedded "Raw profile type APP1" EXIF block), and confirmed Supabase Storage's image-transform endpoint (`/storage/v1/render/image/public/...`) both re-encodes and shrinks it, which strips the offending metadata — verified the transformed output renders correctly.

**Tech Stack:** Next.js Server Actions/Route Handlers, Supabase (Postgres + Storage image transforms), `next/og` (Satori), vitest.

**Spec:** No pre-existing spec covers these — this plan is a direct bug-fix + explicit feature-removal request, documented here in place of one.

## Global Constraints

- Money betting (`lib/betting/*`) is removed entirely, not just hidden — zero live data, per CLAUDE.md's "prefer long-term solutions over short-term fixes."
- Coin wagering (`lib/wagers/*`) is the only betting mechanism after this change — do not touch its settlement/refund/payout math, only the window-open eligibility check.
- The Supabase Storage image-transform rewrite must fall back to the original URL unchanged for any URL that isn't a recognized Supabase Storage public-object URL — never break a working image fetch for an edge case.
- No new npm dependencies — the image-transform fix reuses an existing Supabase Storage capability (confirmed live), not a new image-processing library.

---

## File Structure

```
lib/wagers/market.ts                                  ← MODIFY: full-day carve-out
lib/wagers/market.test.ts                              ← MODIFY: new test cases

lib/og/avatar.ts                                       ← MODIFY: transform-URL rewrite + configurable size
lib/og/avatar.test.ts                                  ← NEW: pure URL-rewrite tests
lib/og/community-post-card.tsx                         ← MODIFY: render the post's own image alongside the avatar
app/(public)/community/[postId]/page.tsx               ← MODIFY: drop the image-override bypass

app/(public)/betting/page.tsx                          ← DELETE
components/match/BettingPanel.tsx                      ← DELETE
components/admin/BettingLockToggle.tsx                 ← DELETE
components/admin/VoidBetsList.tsx                      ← DELETE
lib/betting/actions.ts                                 ← DELETE
lib/betting/market.ts                                  ← DELETE
lib/betting/market.test.ts                             ← DELETE
lib/betting/settle.ts                                  ← DELETE
lib/betting/admin-actions.ts                           ← DELETE
app/(public)/matches/[id]/page.tsx                      ← MODIFY: drop BettingPanel + betting data
app/admin/matches/[id]/review/page.tsx                  ← MODIFY: drop bet query + admin widgets
lib/matches/verify-actions.ts                           ← MODIFY: drop settleMatchBets/refundMatchBets
lib/matches/noshow-actions.ts                           ← MODIFY: drop refundMatchBets
lib/nav/links.ts                                        ← MODIFY: drop /betting nav entry
components/shared/SiteFooter.tsx                        ← MODIFY: drop /betting footer link
components/shared/MobileNavSheet.tsx                    ← MODIFY: drop /betting sheet link
lib/seo/sitemap-entries.ts                              ← MODIFY: drop /betting entry
lib/seo/sitemap-entries.test.ts                         ← MODIFY: update expected entries
lib/wallet/service.ts                                   ← MODIFY: drop bet_* transaction types
supabase/migrations/063_remove_money_betting.sql        ← NEW: drop match_bets + matches.betting_locked
```

---

### Task 1: Fix the wager window's full-day-match bug

**Files:**
- Modify: `lib/wagers/market.ts`
- Modify: `lib/wagers/market.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/wagers/market.test.ts` (alongside its existing `wagerWindowOpen` tests):

```ts
it('stays open through the full play day for a full-day match, closing at day end', () => {
  const match = {
    status: 'scheduled',
    player_a_id: 'a',
    player_b_id: 'b',
    scheduled_at: '2026-08-16T00:00:00Z', // midnight WAT start-of-day, is_full_day
    is_full_day: true,
  }
  // Mid-afternoon on the play day — a naive "scheduled_at - 15min" check
  // would already read this as closed; the full-day carve-out must not.
  expect(wagerWindowOpen(match, new Date('2026-08-16T14:00:00Z'))).toBe(true)
  // After the day ends, it's closed.
  expect(wagerWindowOpen(match, new Date('2026-08-17T00:00:01Z'))).toBe(false)
})

it('still applies the 15-minute pre-kickoff close for a non-full-day match', () => {
  const match = {
    status: 'scheduled',
    player_a_id: 'a',
    player_b_id: 'b',
    scheduled_at: '2026-08-16T18:00:00Z',
    is_full_day: false,
  }
  expect(wagerWindowOpen(match, new Date('2026-08-16T17:44:00Z'))).toBe(true)
  expect(wagerWindowOpen(match, new Date('2026-08-16T17:46:00Z'))).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wagers/market.test.ts`
Expected: FAIL — `match` objects above don't satisfy `WagerMatch` (no `is_full_day` field yet) → TypeScript error, or (if TS is lenient at test time) a logic failure on the first new assertion.

- [ ] **Step 3: Implement the fix**

```ts
// lib/wagers/market.ts
export const WAGER_FEE_RATE = 0.05 // spec §5 — 5% platform fee on the losing pool
export const MIN_WAGER_STAKE = 50
export const MAX_WAGER_STAKE = 2000
export const WAGER_WINDOW_CLOSE_MINUTES = 15

export type WagerMatch = {
  status: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  is_full_day: boolean
}

// Wagering opens the moment both players are confirmed into a scheduled
// match and closes 15 minutes before scheduled_at — EXCEPT for a full-day
// match, where scheduled_at is midnight WAT marking the START of the whole
// play day (see lib/tournaments/round-schedule.ts), not a kickoff instant.
// A player can play at any point during that day, so "15 minutes before
// scheduled_at" would close the window before the day has even begun —
// confirmed live: every currently-scheduled match in production is
// full-day, and all of them read as closed under the old literal-15-minute
// rule. This now mirrors lib/betting/market.ts's bettingOpen, which already
// got this right (lockAt = scheduled_at + 24h for full-day matches) — the
// original "stays literal to the spec, no full-day exception" comment here
// was wrong in practice; the spec's authors didn't anticipate full-day
// scheduling when they wrote the 15-minute rule.
export function wagerWindowOpen(match: WagerMatch, now: Date = new Date()): boolean {
  if (match.status !== 'scheduled') return false
  if (!match.player_a_id || !match.player_b_id) return false
  if (!match.scheduled_at) return false
  const scheduledAt = new Date(match.scheduled_at).getTime()
  const closesAt = match.is_full_day
    ? scheduledAt + 86_400_000
    : scheduledAt - WAGER_WINDOW_CLOSE_MINUTES * 60_000
  return now.getTime() < closesAt
}

export type WagerPools = { playerA: number; playerB: number }
export type WagerSide = 'player_a' | 'player_b'

export function estimateWagerPayout(pools: WagerPools, side: WagerSide, stake: number): number {
  const thisPool = (side === 'player_a' ? pools.playerA : pools.playerB) + stake
  const otherPool = side === 'player_a' ? pools.playerB : pools.playerA
  if (otherPool <= 0) return stake
  return stake + Math.floor(otherPool * (1 - WAGER_FEE_RATE) * (stake / thisPool))
}
```

- [ ] **Step 4: Update the two call sites to pass `is_full_day`**

`lib/wagers/actions.ts` — `placeWager`'s match select already fetches `is_full_day`? Check: it currently selects `'id, status, scheduled_at, player_a_id, player_b_id'` — add `is_full_day`:

```ts
  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, is_full_day')
    .eq('id', matchId)
    .maybeSingle()
```

`app/(public)/matches/[id]/page.tsx` — the `wagerDisabledReason` computation already has `m.is_full_day` in scope (it's already selected for the betting panel / already in `MATCH_SELECT`) — add it to the `wagerWindowOpen` call:

```ts
  const wagerDisabledReason = isParticipant
    ? 'You cannot wager on your own match.'
    : !wagerWindowOpen({ status: m.status, scheduled_at: m.scheduled_at, player_a_id: m.player_a_id, player_b_id: m.player_b_id, is_full_day: m.is_full_day })
      ? 'Wagering is closed. Results pending.'
      : null
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/wagers/market.test.ts`
Expected: PASS (all cases, including the two new ones)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add lib/wagers/market.ts lib/wagers/market.test.ts lib/wagers/actions.ts "app/(public)/matches/[id]/page.tsx"
git commit -m "fix(wagers): full-day matches were unwagerable — window closed before the play day began"
```

---

### Task 2: Remove real-money betting entirely

**Files:** see File Structure above (delete list + modify list for integration points).

- [ ] **Step 1: Remove the money-betting UI and library code**

```bash
git rm "app/(public)/betting/page.tsx"
git rm components/match/BettingPanel.tsx
git rm components/admin/BettingLockToggle.tsx
git rm components/admin/VoidBetsList.tsx
git rm lib/betting/actions.ts lib/betting/market.ts lib/betting/market.test.ts lib/betting/settle.ts lib/betting/admin-actions.ts
```

- [ ] **Step 2: Strip betting out of the match page**

In `app/(public)/matches/[id]/page.tsx`, remove:
- `import { BettingPanel } from '@/components/match/BettingPanel'`
- `import { bettingOpen, type Side } from '@/lib/betting/market'`
- The `pools`, `myBets`, `bettingDisabledReason` computation block
- The `<BettingPanel ... />` JSX block
- `betting_locked` from `MATCH_SELECT` and its row type (keep `is_full_day` — still needed by the wager fix in Task 1 and by the match's own full-day display logic)

- [ ] **Step 3: Strip betting out of admin match review**

In `app/admin/matches/[id]/review/page.tsx`, remove:
- `import { VoidBetsList } from '@/components/admin/VoidBetsList'`
- `import { BettingLockToggle } from '@/components/admin/BettingLockToggle'`
- The `betRows`/`activeBets` query and its mapping
- `betting_locked` from the match select and its row type
- The `<BettingLockToggle .../>` and `<VoidBetsList .../>` JSX

- [ ] **Step 4: Strip the settlement hooks**

`lib/matches/verify-actions.ts`:
- Remove `import { settleMatchBets, refundMatchBets } from '@/lib/betting/settle'`
- Remove the `await refundMatchBets(admin, id)` call (keep `await refundMatchWagers(admin, id)`)
- Remove the `await settleMatchBets(admin, id, winningSide)` call (keep the `settleMatchWagers` block)

`lib/matches/noshow-actions.ts`:
- Remove `import { refundMatchBets } from '@/lib/betting/settle'`
- Remove both `await refundMatchBets(admin, id)` calls (keep both `refundMatchWagers` calls)

- [ ] **Step 5: Remove nav/footer/sitemap entries**

`lib/nav/links.ts` — remove the `{ href: '/betting', label: 'Betting' }` entry.
`components/shared/SiteFooter.tsx` — remove the `{ href: '/betting', label: 'Betting' }` entry.
`components/shared/MobileNavSheet.tsx` — remove the `<SheetLink href="/betting" ...>` block.
`lib/seo/sitemap-entries.ts` — remove the `'/betting'` entry.
`lib/seo/sitemap-entries.test.ts` — update the expected entries list/count to match (read the test first, drop the now-stale assertion for `/betting`).

- [ ] **Step 6: Drop the now-dead wallet transaction types**

`lib/wallet/service.ts` — remove `'bet_stake' | 'bet_payout' | 'bet_refund'` from the transaction-type union and their three entries from the category-mapping `Record`.

- [ ] **Step 7: Migration — drop `match_bets` and `matches.betting_locked`**

```sql
-- 063_remove_money_betting.sql
-- Real-money (naira) betting removed — zero rows in match_bets in
-- production at removal time (confirmed via execute_sql), so this is a
-- clean drop, not a data migration. Coin wagering (match_wagers) is
-- untouched and is now the only betting mechanism.
DROP TABLE public.match_bets;
ALTER TABLE public.matches DROP COLUMN betting_locked;
```

Apply via Supabase MCP (check MCP reachability first per [[project_supabase_connectivity_gotcha]]; fall back to CLI `supabase db push`), then regenerate types:

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

- [ ] **Step 8: Typecheck, lint, test, build**

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```
Expected: all clean, no leftover references to anything just deleted.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove real-money betting entirely — coin wagering is now the only betting mechanism"
```

---

### Task 3: Fix share-card avatars — decoder-safe image resolution

**Files:**
- Modify: `lib/og/avatar.ts`
- Create: `lib/og/avatar.test.ts`

**Interfaces:**
- Produces: `resolveAvatarDataUri(url, dims?)` — new optional second param, existing callers (`match-card.tsx`, `community-post-card.tsx`) keep working unchanged with the new default.

- [ ] **Step 1: Write the failing test**

```ts
// lib/og/avatar.test.ts
import { describe, it, expect } from 'vitest'
import { transformedStorageUrl } from './avatar'

const SUPABASE_URL = 'https://itxubrkbropttfdackmi.supabase.co/storage/v1/object/public/avatars/u1/f1.png'

describe('transformedStorageUrl', () => {
  it('rewrites a Supabase Storage public-object URL to the image-transform endpoint', () => {
    const out = transformedStorageUrl(SUPABASE_URL, 240, 240)
    expect(out).toBe(
      'https://itxubrkbropttfdackmi.supabase.co/storage/v1/render/image/public/avatars/u1/f1.png?width=240&height=240&resize=cover',
    )
  })

  it('leaves a non-Supabase-Storage URL unchanged', () => {
    const other = 'https://example.com/some/image.png'
    expect(transformedStorageUrl(other, 240, 240)).toBe(other)
  })

  it('leaves an unparseable URL unchanged rather than throwing', () => {
    expect(transformedStorageUrl('not a url', 240, 240)).toBe('not a url')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/og/avatar.test.ts`
Expected: FAIL — `transformedStorageUrl` is not exported yet.

- [ ] **Step 3: Implement**

```ts
// lib/og/avatar.ts
// Satori (the next/og renderer) fetches a remote <img src> itself, and on
// a network failure or an unreachable/non-image URL it silently renders a
// blank box rather than throwing or falling back. Fetching and inlining the
// image as a data URI ourselves, with a real try/catch, guarantees an
// unreachable image falls back to initials/a blank slot instead of shipping
// a blank circle.
//
// A second failure mode, confirmed live: some real user-uploaded PNGs are
// large phone-camera photos carrying embedded EXIF/ICC "raw profile" blocks
// (one confirmed case: 6.2MB, 1792×2392, with a full embedded JPEG thumbnail
// in an APP1 profile chunk) that Satori's PNG decoder silently fails to
// parse — no error surfaced to catch, it just renders blank. Routing the
// fetch through Supabase Storage's image-transform endpoint instead of the
// raw object URL re-encodes and shrinks the image, which strips those
// embedded profiles as a side effect — confirmed live that the transformed
// output decodes correctly where the original did not.
//
// Shared by lib/og/match-card.tsx and lib/og/community-post-card.tsx — kept
// here rather than duplicated so both OG renderers get the same fix.

const STORAGE_OBJECT_PATH = '/storage/v1/object/public/'
const STORAGE_RENDER_PATH = '/storage/v1/render/image/public/'

// Pure and exported for testing. Falls back to the original URL unchanged
// for anything that isn't a recognized Supabase Storage public-object URL,
// or that fails to parse as a URL at all — never breaks a working fetch.
export function transformedStorageUrl(url: string, width: number, height: number): string {
  try {
    const u = new URL(url)
    if (!u.pathname.includes(STORAGE_OBJECT_PATH)) return url
    u.pathname = u.pathname.replace(STORAGE_OBJECT_PATH, STORAGE_RENDER_PATH)
    u.searchParams.set('width', String(width))
    u.searchParams.set('height', String(height))
    u.searchParams.set('resize', 'cover')
    return u.toString()
  } catch {
    return url
  }
}

export async function resolveAvatarDataUri(
  url: string,
  dims: { width: number; height: number } = { width: 240, height: 240 },
): Promise<string | null> {
  try {
    const res = await fetch(transformedStorageUrl(url, dims.width, dims.height), { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/og/avatar.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/og/avatar.ts lib/og/avatar.test.ts
git commit -m "fix(og): route avatar/image fetches through Supabase's image-transform endpoint

Some user-uploaded PNGs carry embedded EXIF/ICC profiles large enough that
Satori's decoder silently fails on them (confirmed live: a 6.2MB avatar
rendered as a blank circle in share cards). Re-encoding via Supabase
Storage's transform endpoint strips the offending metadata as a side effect
of resizing."
```

---

### Task 4: Fix share-card avatars — stop bypassing the branded card for image posts

**Files:**
- Modify: `app/(public)/community/[postId]/page.tsx`
- Modify: `lib/og/community-post-card.tsx`

- [ ] **Step 1: Remove the `generateMetadata` bypass**

```ts
// app/(public)/community/[postId]/page.tsx
export async function generateMetadata({ params }: { params: { postId: string } }): Promise<Metadata> {
  const { post } = (await fetchPostDetail(params.postId, null)) ?? {}
  return buildMetadata({
    title: post ? `${post.content.slice(0, 80)} — Sentinel X Community` : 'Community Post — Sentinel X',
    description: post?.content.slice(0, 160) ?? 'A post from the SentinelX community feed.',
    path: `/community/${params.postId}`,
  })
}
```

(Drop the `...(post?.imageUrl ? { image: post.imageUrl } : {})` spread entirely — every post now shares via the branded `opengraph-image.tsx` route, which Step 2 below extends to show the post's own photo too, so nothing is visually lost.)

- [ ] **Step 2: Extend the branded card to show the post's image when present**

```tsx
// lib/og/community-post-card.tsx
import { ImageResponse } from 'next/og'
import { OG_SIZE } from './template'
import { resolveAvatarDataUri } from './avatar'
import { initialsFrom } from '@/lib/nav/tabs'

export interface PostCardOgInput {
  authorName: string
  authorUsername: string | null
  authorAvatarUrl: string | null
  authorTier: string | null
  content: string
  reactionCount: number
  commentCount: number
  postImageUrl: string | null
}

const TIER_ACCENT: Record<string, string> = {
  elite: '#22c55e',
  trusted: '#3b82f6',
  developing: '#eab308',
  at_risk: '#ef4444',
}

function excerpt(content: string, max: number): string {
  const trimmed = content.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

export async function renderCommunityPostCard(input: PostCardOgInput) {
  const [avatarDataUri, postImageDataUri] = await Promise.all([
    input.authorAvatarUrl ? resolveAvatarDataUri(input.authorAvatarUrl) : Promise.resolve(null),
    input.postImageUrl ? resolveAvatarDataUri(input.postImageUrl, { width: 460, height: 460 }) : Promise.resolve(null),
  ])
  const accent = (input.authorTier && TIER_ACCENT[input.authorTier]) || '#7c3aed'

  const avatarBlock = avatarDataUri ? (
    <div
      style={{
        display: 'flex', width: 88, height: 88, borderRadius: '50%',
        backgroundImage: `url(${avatarDataUri})`, backgroundSize: 'cover', backgroundPosition: 'center',
        border: `3px solid ${accent}`,
      }}
    />
  ) : (
    <div
      style={{
        display: 'flex', width: 88, height: 88, borderRadius: '50%',
        alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155',
        color: '#ffffff', fontSize: 32, fontWeight: 700, border: `3px solid ${accent}`,
      }}
    >
      {initialsFrom(input.authorName, input.authorUsername)}
    </div>
  )

  const textColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>
        SENTINEL X COMMUNITY
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 44 }}>
        {avatarBlock}
        <div style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: '#ffffff' }}>{input.authorName}</div>
      </div>
      <div
        style={{
          display: 'flex', fontSize: postImageDataUri ? 32 : 38, fontWeight: 600, color: '#ffffff',
          lineHeight: 1.35, marginTop: 36,
        }}
      >
        {excerpt(input.content, postImageDataUri ? 140 : 180)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 'auto', fontSize: 26, color: '#94a3b8' }}>
        <div style={{ display: 'flex' }}>🔥 {input.reactionCount}</div>
        <div style={{ display: 'flex' }}>💬 {input.commentCount}</div>
      </div>
    </div>
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex',
          flexDirection: postImageDataUri ? 'row' : 'column',
          backgroundColor: '#020617', padding: '64px', gap: postImageDataUri ? 48 : 0,
        }}
      >
        {textColumn}
        {postImageDataUri && (
          <div
            style={{
              display: 'flex', width: 420, height: 420, borderRadius: 24, flexShrink: 0,
              backgroundImage: `url(${postImageDataUri})`, backgroundSize: 'cover', backgroundPosition: 'center',
              border: '3px solid #1e293b',
            }}
          />
        )}
      </div>
    ),
    OG_SIZE,
  )
}
```

- [ ] **Step 3: Pass `postImageUrl` from the route**

```tsx
// app/(public)/community/[postId]/opengraph-image.tsx — in the final renderCommunityPostCard call
  return renderCommunityPostCard({
    authorName: post.author.displayName ?? post.author.username ?? 'A player',
    authorUsername: post.author.username,
    authorAvatarUrl: post.author.avatarUrl,
    authorTier: post.author.sentinelTier,
    content: post.content,
    reactionCount,
    commentCount: post.commentCount,
    postImageUrl: post.imageUrl,
  })
```

Also update the two other call sites in the same file (the "post not found" fallback and nothing else calls `renderCommunityPostCard` there) to pass `postImageUrl: null`.

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean (the `PostCardOgInput` type gained a required field — TS will catch any missed call site).

- [ ] **Step 5: Live verification**

Fetch the same two test posts used during investigation (an image post and a no-image post) from the deployed site's `opengraph-image` route and visually confirm: both now show the author's avatar, and the image post also shows its photo.

- [ ] **Step 6: Commit**

```bash
git add "app/(public)/community/[postId]/page.tsx" "app/(public)/community/[postId]/opengraph-image.tsx" lib/og/community-post-card.tsx
git commit -m "fix(community): stop dropping the author avatar from share cards for posts with images

generateMetadata was overriding the branded opengraph-image route with the
raw uploaded photo whenever a post had one, so the author's avatar/branding
never appeared. The branded card now always renders, showing the post's own
photo as a thumbnail alongside the avatar rather than instead of it."
```

---

### Task 6: Staked friendlies — let players stake coins instead of only ₦

**Design (confirmed with user):** one currency per challenge — the challenger picks coins **or** ₦ plus an amount when sending the challenge; both players stake that same amount in that same currency (symmetric, mirrors today's ₦-only flow exactly, no cross-currency conversion). Coin stakes settle instantly (debit/credit via `recordCoinTransaction`, no Paystack/webhook); ₦ stakes are completely unchanged. No platform fee on either currency's payout — matches today's ₦ friendlies, which already take no cut (unlike the 5% wager fee). Coin stake bounds reuse the existing wager limits (`MIN_WAGER_STAKE`/`MAX_WAGER_STAKE` = 50–2000) rather than inventing new ones.

**Files:**
- Create: `supabase/migrations/064_friendly_stake_currency.sql`
- Modify: `lib/friendly-matches/schema.ts`, `lib/friendly-matches/actions.ts`, `lib/friendly-matches/pay-actions.ts`, `lib/friendly-matches/admin-actions.ts`
- Modify: `components/player/ChallengeButton.tsx`, `components/friendly/MatchRoom.tsx`
- Modify: `app/dashboard/friendlies/[id]/page.tsx`, `app/admin/friendlies/page.tsx`, `components/admin/FriendlyQueueRow.tsx`

- [ ] **Step 1: Migration — add `stake_currency`, backfill existing rows, extend coin sources**

```sql
-- 064_friendly_stake_currency.sql
-- Lets a staked friendly be denominated in SX Coins as an alternative to
-- naira (user request) — one currency per challenge, symmetric stake,
-- mirrors the existing naira-only flow exactly.

ALTER TABLE public.friendly_matches
  ADD COLUMN stake_currency text CHECK (stake_currency IN ('naira', 'coins'));

-- Every existing staked friendly (stake_amount IS NOT NULL) predates this
-- column and was always naira — backfill before adding the pairing CHECK
-- below, or those historical rows would violate it.
UPDATE public.friendly_matches SET stake_currency = 'naira' WHERE stake_amount IS NOT NULL;

ALTER TABLE public.friendly_matches
  ADD CONSTRAINT friendly_matches_stake_currency_pairing
  CHECK ((stake_amount IS NULL AND stake_currency IS NULL) OR (stake_amount IS NOT NULL AND stake_currency IS NOT NULL));

ALTER TABLE public.sx_coin_transactions
  DROP CONSTRAINT sx_coin_transactions_source_check;
ALTER TABLE public.sx_coin_transactions
  ADD CONSTRAINT sx_coin_transactions_source_check CHECK (source IN (
    'match_played', 'match_won', 'tournament_placement',
    'daily_login', 'login_streak', 'achievement_unlocked',
    'store_purchase', 'community_activity',
    'admin_grant', 'admin_deduct',
    'weekly_challenge', 'best_play_winner', 'best_play_runner_up',
    'entry_discount', 'entry_discount_refund',
    'wager_stake', 'wager_won', 'wager_refund',
    'post_boost',
    'friendly_stake', 'friendly_stake_payout'
  ));
```

Apply via Supabase MCP (or CLI fallback), then regenerate types — same procedure as Task 2 Step 7.

- [ ] **Step 2: Extend the challenge schema**

```ts
// lib/friendly-matches/schema.ts
import { z } from 'zod'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

export const MIN_NAIRA_STAKE = 100

export const challengeSchema = z
  .object({
    opponentId: z.string().uuid(),
    stakeAmount: z.union([z.literal(''), z.coerce.number().int().positive()]),
    stakeCurrency: z.union([z.literal(''), z.enum(['naira', 'coins'])]),
    gameCode: z.union([z.literal(''), z.string().trim().max(100)]),
  })
  .refine((d) => d.stakeAmount === '' || d.stakeCurrency !== '', {
    message: 'Choose a stake currency.',
    path: ['stakeCurrency'],
  })
  .refine((d) => d.stakeAmount === '' || d.stakeCurrency === 'coins' || d.stakeAmount >= MIN_NAIRA_STAKE, {
    message: `Minimum ₦ stake is ₦${MIN_NAIRA_STAKE}`,
    path: ['stakeAmount'],
  })
  .refine(
    (d) => d.stakeAmount === '' || d.stakeCurrency === 'naira' || (d.stakeAmount >= MIN_WAGER_STAKE && d.stakeAmount <= MAX_WAGER_STAKE),
    { message: `Coin stake must be between ${MIN_WAGER_STAKE} and ${MAX_WAGER_STAKE}`, path: ['stakeAmount'] },
  )

export type ChallengeInput = z.infer<typeof challengeSchema>
```

- [ ] **Step 3: `sendChallenge` — persist currency, branch the notification copy**

In `lib/friendly-matches/actions.ts`, update `sendChallenge`:

```ts
  const parsed = challengeSchema.safeParse({
    opponentId: formData.get('opponentId') ?? '',
    stakeAmount: formData.get('stakeAmount') ?? '',
    stakeCurrency: formData.get('stakeCurrency') ?? '',
    gameCode: formData.get('gameCode') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === parsed.data.opponentId) return { error: "You can't challenge yourself." }

  const stakeAmount = parsed.data.stakeAmount === '' ? null : parsed.data.stakeAmount
  const stakeCurrency = parsed.data.stakeCurrency === '' ? null : parsed.data.stakeCurrency
  const gameCode = parsed.data.gameCode === '' ? null : parsed.data.gameCode

  const { data: created, error } = await supabase
    .from('friendly_matches')
    .insert({
      challenger_id: user.id,
      opponent_id: parsed.data.opponentId,
      stake_amount: stakeAmount,
      stake_currency: stakeCurrency,
      game_code: gameCode,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !created) return { error: 'Could not send the challenge. Please try again.' }

  await notifyInApp({
    playerId: parsed.data.opponentId,
    type: 'friend_request',
    title: stakeAmount ? 'Staked challenge received' : 'Friendly challenge received',
    body: stakeAmount
      ? stakeCurrency === 'coins'
        ? `You've been challenged to a ${stakeAmount}-coin staked friendly.`
        : `You've been challenged to a ₦${stakeAmount} staked friendly.`
      : "You've been challenged to a friendly match.",
    link: `/dashboard/friendlies/${created.id}`,
  })

  revalidatePath('/dashboard')
  return { success: true, matchId: created.id }
```

(`acceptChallenge`/`declineChallenge` are unaffected — they only branch on whether `stake_amount` is set, not on currency.)

- [ ] **Step 4: `payStake` — instant coin settlement branch**

```ts
// lib/friendly-matches/pay-actions.ts
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildFriendlyStakeReference } from '@/lib/paystack/server'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type PayStakeState = { error?: string } | undefined

export async function payStake(_prev: PayStakeState, formData: FormData): Promise<PayStakeState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, stake_amount, stake_currency, status, challenger_paid, opponent_paid')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this challenge can pay.' }
  }
  if (fm.status !== 'awaiting_payment') return { error: 'This challenge is not awaiting payment.' }
  if (!fm.stake_amount || !fm.stake_currency) return { error: 'This is a free friendly — no payment needed.' }

  const isChallenger = user.id === fm.challenger_id

  // Coins settle instantly — no external redirect/webhook needed, unlike
  // the Paystack path below.
  if (fm.stake_currency === 'coins') {
    const admin = createAdminClient()
    const balance = await getCoinBalance(admin, user.id)
    if (balance < fm.stake_amount) return { error: 'Not enough SX Coins for this stake.' }
    await recordCoinTransaction(admin, user.id, -fm.stake_amount, 'friendly_stake', id, `Friendly stake — match ${id}`)

    const otherPaid = isChallenger ? fm.opponent_paid : fm.challenger_paid
    const nextStatus = otherPaid ? 'active' : 'awaiting_payment'
    await admin
      .from('friendly_matches')
      .update(isChallenger ? { challenger_paid: true, status: nextStatus } : { opponent_paid: true, status: nextStatus })
      .eq('id', id)

    revalidatePath(`/dashboard/friendlies/${id}`)
    return undefined
  }

  const reference = buildFriendlyStakeReference(id, user.id)
  if (isChallenger) {
    await supabase.from('friendly_matches').update({ challenger_paystack_reference: reference }).eq('id', id)
  } else {
    await supabase.from('friendly_matches').update({ opponent_paystack_reference: reference }).eq('id', id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: fm.stake_amount * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { friendly_match_id: id, player_id: user.id },
    })
  } catch (err) {
    console.error('[payStake] Paystack initialize failed', {
      id, reference, message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
```

- [ ] **Step 5: `confirmFriendlyResult` — coin payout branch**

In `lib/friendly-matches/admin-actions.ts`, add `stake_currency` to the match select (`'id, challenger_id, opponent_id, stake_amount, stake_currency, status'`), and branch the payout:

```ts
    // winnerId is guaranteed non-null here — a draw on a staked match was
    // already rejected above, before this block can be reached.
    if (fm.stake_currency === 'coins') {
      await recordCoinTransaction(admin, winnerId as string, fm.stake_amount * 2, 'friendly_stake_payout', fm.id, 'Friendly match won — stake payout')
    } else {
      await creditWallet(admin, winnerId as string, fm.stake_amount * 2, 'friendly_stake', fm.id)
    }
```

Add the import: `import { recordCoinTransaction } from '@/lib/coins/service'`.

- [ ] **Step 6: `ChallengeButton` — currency picker**

```tsx
// components/player/ChallengeButton.tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { sendChallenge, type FriendlyActionState } from '@/lib/friendly-matches/actions'

export function ChallengeButton({ opponentId }: { opponentId: string }) {
  const [showStake, setShowStake] = useState(false)
  const [state, action] = useFormState<FriendlyActionState, FormData>(sendChallenge, undefined)

  if (state?.success) return <p className="text-sm text-emerald-400">Challenge sent.</p>

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="opponentId" value={opponentId} />
      <input
        name="gameCode"
        type="text"
        maxLength={100}
        placeholder="Game code (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={showStake} onChange={(e) => setShowStake(e.target.checked)} />
          Add a stake
        </label>
      </div>
      {showStake && (
        <>
          <input
            name="stakeAmount"
            type="number"
            min={1}
            placeholder="Stake amount"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
          <div className="flex gap-4 text-xs text-slate-400">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="stakeCurrency" value="coins" defaultChecked /> 🪙 Coins
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="stakeCurrency" value="naira" /> ₦ Naira
            </label>
          </div>
        </>
      )}
      <button
        type="submit"
        className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        {showStake ? 'Send staked challenge' : 'Challenge to a friendly'}
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 7: `MatchRoom` — currency-aware pay button + copy**

In `components/friendly/MatchRoom.tsx`, add a `stakeCurrency: 'naira' | 'coins' | null` prop and use it in the `awaiting_payment` branch:

```tsx
  const stakeLabel = stakeCurrency === 'coins' ? `${stakeAmount} coins` : `₦${stakeAmount}`
```

```tsx
  if (status === 'awaiting_payment') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="mb-3 text-sm text-slate-300">
          Both players must pay {stakeLabel} to unlock the Match Room.
        </p>
        {myPaid ? (
          <p className="text-sm font-semibold text-emerald-400">You&apos;ve paid — waiting on your opponent.</p>
        ) : (
          <form action={payAction}>
            <input type="hidden" name="id" value={matchId} />
            <button type="submit" className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
              Pay {stakeLabel}
            </button>
            {payState?.error && <p className="mt-2 text-xs text-red-400">{payState.error}</p>}
          </form>
        )}
      </div>
    )
  }
```

- [ ] **Step 8: Thread `stake_currency` through the two pages + admin queue**

`app/dashboard/friendlies/[id]/page.tsx` — add `stake_currency` to the select string and row type, pass `stakeCurrency={data.stake_currency}` to `<MatchRoom>`, and update the header line:

```tsx
        {data.stake_amount
          ? data.stake_currency === 'coins'
            ? ` · ${data.stake_amount} coins stake`
            : ` · ₦${data.stake_amount} stake`
          : ' · Free friendly'}
```

`app/admin/friendlies/page.tsx` — add `stake_currency` to the select string, row type, and the mapped object passed to `FriendlyQueueRow`.

`components/admin/FriendlyQueueRow.tsx` — add `stakeCurrency: 'naira' | 'coins' | null` to props and branch the display line:

```tsx
{req.stakeAmount && (
  <p className="shrink-0 text-sm font-semibold text-violet-400">
    {req.stakeCurrency === 'coins' ? `${req.stakeAmount} coins` : formatNaira(req.stakeAmount)} stake
  </p>
)}
```

- [ ] **Step 9: Typecheck, lint, test, build**

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(friendlies): staked friendlies can be denominated in coins as well as naira"
```

---

### Task 7: Final verification, ROADMAP note, merge and push

- [ ] **Step 1: Full verification**

```bash
npx vitest run
npx tsc --noEmit
npx eslint .
npm run build
```

- [ ] **Step 2: Live smoke-check**

Confirm on the deployed site: a full-day scheduled match's Wager widget is enabled (not "Wagering is closed"); `/betting` returns 404 (route removed) and no nav/footer link points to it; a shared image-post card shows both the author avatar and the post photo.

- [ ] **Step 3: ROADMAP note**

Add a short note to `ROADMAP.md` (near the Phase 2 Economy / wager section) recording the wager-window fix and the money-betting removal, following the existing changelog-style convention in that file.

- [ ] **Step 4: Merge to main and push**

Per [[feedback_always_push]]: merge the feature branch to `main` and push `origin/main` once verification is complete.

---

## Self-Review Notes

- **Root cause, not symptom:** all three fixes trace to a specific confirmed mechanism (full-day carve-out gap; zero-data feature removal; metadata-override bypass; Satori PNG decoder limitation worked around via re-encoding) — none are guesses.
- **Money-betting removal is total**, not a partial hide: nav, footer, sitemap, admin tooling, settlement hooks, DB schema all covered — a stray link or dead settlement call would be a real regression.
- **Coin wagering math (`settle.ts`, payout computation) is explicitly untouched** in both Task 1 and Task 2 — only the window-eligibility check changes.
- **Share-card fix doesn't regress the "show the real photo" behavior** — Task 4 adds the photo back as a thumbnail rather than just restoring the avatar and losing the photo.
