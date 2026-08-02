# Shareable Match Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones match OG image with a branded hype/result card, and let players actively share or download it from the Match Centre page.

**Architecture:** One data-loading module picks a card variant (`hype` for a scheduled match, `result` for a completed one) and maps a match row into a plain input object; one render module turns that input into a `next/og` `ImageResponse`. Both the existing `opengraph-image.tsx` (passive link previews) and a new `/api/matches/[id]/card` route (active download/share) call the same two modules, so there's exactly one place that decides what the card looks like.

**Tech Stack:** Next.js 14 `next/og` (`ImageResponse`, edge runtime), Supabase, Web Share API with a download fallback.

## Global Constraints

- One render path feeds both the OG meta tag and the on-page Share button — never duplicate the card layout.
- Card variant is picked automatically from `matches.status`: `'completed'` → result card, everything else → hype card (spec: "Card states" — non-scheduled/non-completed statuses fall back to hype without a winner tag, matching what the passive OG image already has to handle today).
- Group-stage draws render the result card with both scores but no winner emphasis (`winnerSide: null`) — mirrors the same draw case handled in the betting plan.
- Reuse `initialsFrom` (`lib/nav/tabs.ts`) for the avatar-fallback initials — do not reimplement it.
- Follow existing code style: no semicolons, inline `style` objects inside `ImageResponse` trees (Satori doesn't support Tailwind classes — see the comment already in `lib/og/template.tsx`), `'use client'` only on the Share button.

---

## File Structure

- `lib/og/match-card-data.ts` — new: `selectCardVariant`, `resultWinnerSide` (pure), `loadMatchCardInput` (DB-touching), shared `CardPlayer`/`HypeCardInput`/`ResultCardInput` types.
- `lib/og/match-card-data.test.ts` — new: tests the two pure functions.
- `lib/og/match-card.tsx` — new: `renderMatchCard(input)`.
- `app/(public)/matches/[id]/opengraph-image.tsx` — modify: call `loadMatchCardInput` + `renderMatchCard` instead of the current inline query + `renderOgImage`.
- `app/api/matches/[id]/card/route.ts` — new: same data/render, returned as a fetchable PNG for the Share button.
- `components/match/ShareCardButton.tsx` — new: client component, Web Share API with download fallback.
- `app/(public)/matches/[id]/page.tsx` — modify: render `ShareCardButton` next to the existing "Share on WhatsApp" link.

---

### Task 1: Card variant selection + data loader

**Files:**
- Create: `lib/og/match-card-data.ts`
- Test: `lib/og/match-card-data.test.ts`

**Interfaces:**
- Consumes: `formatFixtureDate` from `lib/format.ts`.
- Produces: `CardPlayer`, `HypeCardInput`, `ResultCardInput`, `selectCardVariant(status): 'hype' | 'result'`, `resultWinnerSide(scoreA, scoreB): 'player_a' | 'player_b' | null`, `loadMatchCardInput(supabase, matchId): Promise<HypeCardInput | ResultCardInput | null>` — consumed by Task 2 (`match-card.tsx`), Task 3 (`opengraph-image.tsx`), Task 4 (`card/route.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/og/match-card-data.test.ts
import { describe, it, expect } from 'vitest'
import { selectCardVariant, resultWinnerSide } from './match-card-data'

describe('selectCardVariant', () => {
  it('returns result for a completed match', () => {
    expect(selectCardVariant('completed')).toBe('result')
  })

  it('returns hype for scheduled, live, disputed, cancelled, and bye', () => {
    for (const status of ['scheduled', 'live', 'disputed', 'cancelled', 'bye', 'forfeited']) {
      expect(selectCardVariant(status)).toBe('hype')
    }
  })
})

describe('resultWinnerSide', () => {
  it('picks the higher score', () => {
    expect(resultWinnerSide(3, 1)).toBe('player_a')
    expect(resultWinnerSide(1, 3)).toBe('player_b')
  })

  it('returns null for a draw', () => {
    expect(resultWinnerSide(2, 2)).toBeNull()
  })

  it('returns null when either score is missing', () => {
    expect(resultWinnerSide(null, 2)).toBeNull()
    expect(resultWinnerSide(2, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/og/match-card-data.test.ts`
Expected: FAIL — `Cannot find module './match-card-data'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/og/match-card-data.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { formatFixtureDate } from '@/lib/format'

export type CardPlayer = {
  displayName: string | null
  username: string | null
  avatarUrl: string | null
}

export type HypeCardInput = {
  variant: 'hype'
  tournamentTitle: string
  playerA: CardPlayer
  playerB: CardPlayer
  scheduledLabel: string | null
}

export type ResultCardInput = {
  variant: 'result'
  tournamentTitle: string
  playerA: CardPlayer
  playerB: CardPlayer
  scoreA: number
  scoreB: number
  winnerSide: 'player_a' | 'player_b' | null
}

// Anything not yet completed shows the hype layout — including live, disputed,
// cancelled, forfeited, and bye. There's no result worth showing yet for any
// of those, and erroring would break the existing passive OG-image use case
// those statuses already rely on today.
export function selectCardVariant(status: string): 'hype' | 'result' {
  return status === 'completed' ? 'result' : 'hype'
}

export function resultWinnerSide(scoreA: number | null, scoreB: number | null): 'player_a' | 'player_b' | null {
  if (scoreA == null || scoreB == null || scoreA === scoreB) return null
  return scoreA > scoreB ? 'player_a' : 'player_b'
}

type ProfileRef = { username: string | null; display_name: string | null; avatar_url: string | null }
type Ref<T> = T | T[] | null
function firstOf<T>(x: Ref<T>): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}
function toCardPlayer(p: Ref<ProfileRef>): CardPlayer {
  const r = firstOf(p)
  return { displayName: r?.display_name ?? null, username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
}

export async function loadMatchCardInput(
  supabase: SupabaseClient<Database>,
  matchId: string,
): Promise<HypeCardInput | ResultCardInput | null> {
  const { data: m } = await supabase
    .from('matches')
    .select(
      'status, score_a, score_b, scheduled_at, is_full_day, ' +
        'tournaments(title), ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url)',
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!m) return null

  const playerA = toCardPlayer(m.player_a as Ref<ProfileRef>)
  const playerB = toCardPlayer(m.player_b as Ref<ProfileRef>)
  const tournamentTitle = firstOf(m.tournaments as Ref<{ title: string }>)?.title ?? 'Sentinel X'

  if (selectCardVariant(m.status) === 'result') {
    return {
      variant: 'result',
      tournamentTitle,
      playerA,
      playerB,
      scoreA: m.score_a ?? 0,
      scoreB: m.score_b ?? 0,
      winnerSide: resultWinnerSide(m.score_a, m.score_b),
    }
  }
  return {
    variant: 'hype',
    tournamentTitle,
    playerA,
    playerB,
    scheduledLabel: formatFixtureDate(m.scheduled_at, m.is_full_day),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/og/match-card-data.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/og/match-card-data.ts lib/og/match-card-data.test.ts
git commit -m "feat(cards): add match card variant selection and data loader"
```

---

### Task 2: Card render function

**Files:**
- Create: `lib/og/match-card.tsx`

**Interfaces:**
- Consumes: `HypeCardInput`, `ResultCardInput`, `CardPlayer` from Task 1; `OG_SIZE` from `lib/og/template.tsx`; `initialsFrom` from `lib/nav/tabs.ts`.
- Produces: `renderMatchCard(input): ImageResponse` — consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the implementation**

```tsx
// lib/og/match-card.tsx
import { ImageResponse } from 'next/og'
import { OG_SIZE } from './template'
import { initialsFrom } from '@/lib/nav/tabs'
import type { CardPlayer, HypeCardInput, ResultCardInput } from './match-card-data'

function playerLabel(p: CardPlayer): string {
  return p.displayName ?? p.username ?? 'TBD'
}

// Satori (the next/og renderer) can't parse variable fonts and doesn't take
// Tailwind classes — every style here is inline, matching the constraint
// already documented in lib/og/template.tsx.
function PlayerBlock({ player, highlight }: { player: CardPlayer; highlight: boolean }) {
  const ringColor = highlight ? '#34d399' : '#1e293b'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 320 }}>
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          width={120}
          height={120}
          style={{ borderRadius: '50%', objectFit: 'cover', border: `4px solid ${ringColor}` }}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            width: 120,
            height: 120,
            borderRadius: '50%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#334155',
            color: '#ffffff',
            fontSize: 44,
            fontWeight: 700,
            border: `4px solid ${ringColor}`,
          }}
        >
          {initialsFrom(player.displayName, player.username)}
        </div>
      )}
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#ffffff', textAlign: 'center' }}>
        {playerLabel(player)}
      </div>
      {highlight && (
        <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: '#34d399', letterSpacing: '0.15em' }}>
          WINNER
        </div>
      )}
    </div>
  )
}

function CardShell({
  tournamentTitle,
  children,
}: {
  tournamentTitle: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#020617',
        padding: '60px',
      }}
    >
      <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>
        SENTINEL X
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: '#94a3b8', marginTop: 8, marginBottom: 40 }}>
        {tournamentTitle}
      </div>
      {children}
    </div>
  )
}

function renderHype(input: HypeCardInput) {
  return new ImageResponse(
    (
      <CardShell tournamentTitle={input.tournamentTitle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <PlayerBlock player={input.playerA} highlight={false} />
          <div style={{ display: 'flex', fontSize: 48, fontWeight: 900, color: '#475569' }}>VS</div>
          <PlayerBlock player={input.playerB} highlight={false} />
        </div>
        {input.scheduledLabel && (
          <div style={{ display: 'flex', fontSize: 24, color: '#94a3b8', marginTop: 40 }}>{input.scheduledLabel}</div>
        )}
      </CardShell>
    ),
    OG_SIZE,
  )
}

function renderResult(input: ResultCardInput) {
  return new ImageResponse(
    (
      <CardShell tournamentTitle={input.tournamentTitle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <PlayerBlock player={input.playerA} highlight={input.winnerSide === 'player_a'} />
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 900, color: '#ffffff' }}>
            {input.scoreA} – {input.scoreB}
          </div>
          <PlayerBlock player={input.playerB} highlight={input.winnerSide === 'player_b'} />
        </div>
      </CardShell>
    ),
    OG_SIZE,
  )
}

export function renderMatchCard(input: HypeCardInput | ResultCardInput) {
  return input.variant === 'result' ? renderResult(input) : renderHype(input)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/og/match-card.tsx
git commit -m "feat(cards): add hype/result match card renderer"
```

---

### Task 3: Rewrite the passive OG meta image

**Files:**
- Modify: `app/(public)/matches/[id]/opengraph-image.tsx` (full rewrite — replaces the entire existing file)

**Interfaces:**
- Consumes: `loadMatchCardInput` (Task 1), `renderMatchCard` (Task 2).

- [ ] **Step 1: Rewrite the file**

```tsx
// app/(public)/matches/[id]/opengraph-image.tsx
import { createClient } from '@/lib/supabase/server'
import { OG_SIZE } from '@/lib/og/template'
import { loadMatchCardInput } from '@/lib/og/match-card-data'
import { renderMatchCard } from '@/lib/og/match-card'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const input = await loadMatchCardInput(supabase, params.id)
  if (!input) {
    // Same shape as before for a match that no longer exists — the route
    // itself 404s via the page's own notFound(), this only covers the rare
    // case where the OG image is requested for an id the page hasn't.
    return renderMatchCard({
      variant: 'hype',
      tournamentTitle: 'Sentinel X',
      playerA: { displayName: 'TBD', username: null, avatarUrl: null },
      playerB: { displayName: 'TBD', username: null, avatarUrl: null },
      scheduledLabel: null,
    })
  }
  return renderMatchCard(input)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open `http://localhost:3000/matches/[a-real-match-id]/opengraph-image` directly in a browser for one scheduled match and one completed match, confirm the hype/result layouts render correctly with avatars (or initials) and the winner tag.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/matches/[id]/opengraph-image.tsx"
git commit -m "feat(cards): use the branded match card for the OG meta image"
```

---

### Task 4: Downloadable card API route

**Files:**
- Create: `app/api/matches/[id]/card/route.ts`

**Interfaces:**
- Consumes: `loadMatchCardInput` (Task 1), `renderMatchCard` (Task 2).
- Produces: `GET /api/matches/[id]/card` — consumed by Task 5 (`ShareCardButton.tsx`).

- [ ] **Step 1: Write the route**

```ts
// app/api/matches/[id]/card/route.ts
import { createClient } from '@/lib/supabase/server'
import { loadMatchCardInput } from '@/lib/og/match-card-data'
import { renderMatchCard } from '@/lib/og/match-card'

export const runtime = 'edge'

// No Content-Disposition: attachment — the Share button reads this as a
// blob for navigator.share()/an object URL, not a browser-triggered
// download. Deliberately the same render path as opengraph-image.tsx so
// the passive link preview and the active share/download never drift.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const input = await loadMatchCardInput(supabase, params.id)
  if (!input) return new Response('Not found', { status: 404 })
  return renderMatchCard(input)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, `curl -o card.png http://localhost:3000/api/matches/[a-real-match-id]/card` (or open the URL directly in a browser), confirm a PNG is returned and matches the OG image from Task 3 for the same match.

- [ ] **Step 4: Commit**

```bash
git add "app/api/matches/[id]/card/route.ts"
git commit -m "feat(cards): add downloadable match card API route"
```

---

### Task 5: Share button on the Match Centre page

**Files:**
- Create: `components/match/ShareCardButton.tsx`
- Modify: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/matches/[id]/card` (Task 4).

- [ ] **Step 1: Write the button**

```tsx
// components/match/ShareCardButton.tsx
'use client'
import { useState } from 'react'

export function ShareCardButton({ matchId, shareText }: { matchId: string; shareText: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')

  async function handleShare() {
    setState('busy')
    try {
      const res = await fetch(`/api/matches/${matchId}/card`)
      if (!res.ok) throw new Error('card fetch failed')
      const blob = await res.blob()
      const file = new File([blob], 'sentinel-x-match.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Sentinel X', text: shareText })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'sentinel-x-match.png'
        a.click()
        URL.revokeObjectURL(url)
      }
      setState('idle')
    } catch {
      // A user cancelling the native share sheet also lands here (share()
      // rejects on cancel) — that isn't a real error, so don't surface it
      // as one; just fall back to idle silently.
      setState('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={state === 'busy'}
      className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 px-6 py-3 text-sm font-bold text-violet-400 transition-colors hover:bg-violet-500/10 disabled:opacity-50"
    >
      {state === 'busy' ? 'Preparing…' : 'Share card'}
    </button>
  )
}
```

- [ ] **Step 2: Wire it into the Match Centre page**

In `app/(public)/matches/[id]/page.tsx`, add the import:

```ts
import { ShareCardButton } from '@/components/match/ShareCardButton'
```

Change the final block (the existing "Share on WhatsApp" link) from a single element to a flex row containing both buttons:

```tsx
      <div className="flex flex-wrap gap-3">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Share on WhatsApp
        </a>
        <ShareCardButton matchId={m.id} shareText={shareText} />
      </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev` on a mobile device or Chrome's device emulation with Web Share API support, open a match page, tap "Share card", confirm the native share sheet opens with the card image attached. Then test on desktop Chrome (no file-share support) and confirm it falls back to a direct PNG download.

- [ ] **Step 5: Commit**

```bash
git add components/match/ShareCardButton.tsx "app/(public)/matches/[id]/page.tsx"
git commit -m "feat(cards): add share/download button to the Match Centre page"
```

---

## Self-Review Notes

- **Spec coverage:** hype/result variants incl. non-scheduled/non-completed fallback and draw handling (Task 1, 2), single shared render path for both OG meta tag and active share (Task 3, 4 both call `loadMatchCardInput` + `renderMatchCard`), Web Share API with download fallback (Task 5) — all covered.
- **Placeholder scan:** none — every step has runnable code.
- **Type consistency:** `CardPlayer`/`HypeCardInput`/`ResultCardInput` defined once in `lib/og/match-card-data.ts`, imported by both `match-card.tsx` and the two consuming routes — no redefinition anywhere.
