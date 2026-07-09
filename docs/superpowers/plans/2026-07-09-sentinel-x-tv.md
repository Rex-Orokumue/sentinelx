# Sentinel X TV (#11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/tv` — a public hub stitching match-derived videos (live/finals/replays from `matches`) with curated clips from a new `tv_videos` table — plus a minimal `/admin/tv` CRUD, and wire the Watch pillar to it.

**Architecture:** A new `tv_videos` table (RLS: public reads active rows, staff writes) feeds curated content; match videos come from existing `matches` columns. Pure helpers (`lib/tv/*`) handle YouTube thumbnails and validation. Curated clips play in a responsive overlay (`VideoModal`); match cards link to the Match Centre. Admin content is managed with `requireStaff` server actions through the session client (RLS enforces staff).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase, Vitest, lucide-react.

## Global Constraints

- Video is **YouTube-embed only**; reuse `parseYouTubeId` / `youtubeEmbedUrl` (`lib/matches/youtube.ts`).
- **Autoplay must be muted** — `VideoModal` embeds with `{ autoplay: true, mute: true }` (mobile blocks unmuted autoplay).
- Thumbnails: `thumbnail_url` if set, else `https://img.youtube.com/vi/{id}/hqdefault.jpg`; render with a plain `<img>` (+ `// eslint-disable-next-line @next/next/no-img-element`) to avoid next/image remote config.
- Sections render in order **Live Now → Highlights → Finals → All Replays**, each hidden when empty; Replays is a hard `.limit(12)` (no pagination in v1).
- Admin surface is **staff-visible** (`adminOnly: false`); moderators managing/deleting editorial content is intentional for a small team.
- Admin writes: `requireStaff` + session client (`@/lib/supabase/server`), so RLS staff policies apply; `created_by = ctx.userId`.
- Tests: Vitest, colocated `*.test.ts`; run one file with `npx vitest run <path>`.
- **Never run concurrent builds** — parallel `npm run build`/dev race on `.next` (ENOENT renaming `500.html`). One build at a time; if a build errors on that, `rm -rf .next` and rebuild once.

---

### Task 1: `tv_videos` table + types

**Files:**
- Create: `supabase/migrations/010_tv_videos.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: the `tv_videos` table and its Row/Insert/Update types. Consumed by Tasks 5, 6.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/010_tv_videos.sql`:

```sql
-- Curated Sentinel X TV videos (standalone YouTube clips managed by staff).
CREATE TABLE public.tv_videos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  youtube_url   text        NOT NULL,
  category      text        NOT NULL
                  CHECK (category IN ('highlight', 'interview', 'recap', 'best_goal')),
  thumbnail_url text,
  published_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL REFERENCES public.profiles(id),
  active        boolean     NOT NULL DEFAULT true
);

CREATE INDEX ON public.tv_videos (published_at DESC);

ALTER TABLE public.tv_videos ENABLE ROW LEVEL SECURITY;

-- Public sees active rows; staff see everything (for the admin list).
CREATE POLICY "tv_videos_public_read" ON public.tv_videos
  FOR SELECT USING (active OR public.is_staff());
CREATE POLICY "tv_videos_staff_insert" ON public.tv_videos
  FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "tv_videos_staff_update" ON public.tv_videos
  FOR UPDATE USING (public.is_staff());
CREATE POLICY "tv_videos_staff_delete" ON public.tv_videos
  FOR DELETE USING (public.is_staff());
```

- [ ] **Step 2: Apply to the live project**

Apply via Supabase MCP `apply_migration` (name: `tv_videos`, the SQL above).

- [ ] **Step 3: Verify the table + RLS**

Via MCP `execute_sql`:
```sql
SELECT count(*) AS videos FROM public.tv_videos;
SELECT polname FROM pg_policy WHERE polrelid = 'public.tv_videos'::regclass ORDER BY polname;
```
Expected: `videos = 0`; four policies (`tv_videos_public_read`, `_staff_delete`, `_staff_insert`, `_staff_update`).

- [ ] **Step 4: Regenerate types**

Run Supabase MCP `generate_typescript_types` for project `itxubrkbropttfdackmi` and overwrite `lib/supabase/types.ts` with the result (adds `tv_videos`).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add supabase/migrations/010_tv_videos.sql lib/supabase/types.ts
git commit -m "feat: tv_videos table + RLS (#11)"
```

---

### Task 2: muted-embed support + thumbnail helper

**Files:**
- Modify: `lib/matches/youtube.ts`
- Modify: `lib/matches/youtube.test.ts`
- Create: `lib/tv/thumbnail.ts`
- Test: `lib/tv/thumbnail.test.ts`

**Interfaces:**
- Produces: `youtubeEmbedUrl(id, { autoplay?, mute? })`; `youtubeThumbnail(url: string | null): string | null`. Consumed by Tasks 4, 5.

- [ ] **Step 1: Write the failing tests**

Append to `lib/matches/youtube.test.ts` (inside the file, add a new `describe`):

```ts
import { youtubeEmbedUrl } from './youtube'

describe('youtubeEmbedUrl options', () => {
  it('has no query string with no options', () => {
    expect(youtubeEmbedUrl('abcdefghijk')).toBe('https://www.youtube.com/embed/abcdefghijk')
  })
  it('adds autoplay and mute when requested', () => {
    const url = youtubeEmbedUrl('abcdefghijk', { autoplay: true, mute: true })
    expect(url).toContain('autoplay=1')
    expect(url).toContain('mute=1')
  })
})
```

Create `lib/tv/thumbnail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { youtubeThumbnail } from './thumbnail'

describe('youtubeThumbnail', () => {
  it('builds a thumbnail URL from a watch link', () => {
    expect(youtubeThumbnail('https://www.youtube.com/watch?v=abcdefghijk')).toBe(
      'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg',
    )
  })
  it('returns null for an unparseable or missing URL', () => {
    expect(youtubeThumbnail('https://example.com/nope')).toBeNull()
    expect(youtubeThumbnail(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tv/thumbnail.test.ts lib/matches/youtube.test.ts`
Expected: FAIL — `./thumbnail` unresolved and `youtubeEmbedUrl` mute assertion fails.

- [ ] **Step 3: Extend `youtubeEmbedUrl`**

In `lib/matches/youtube.ts`, replace the `youtubeEmbedUrl` function with:

```ts
export function youtubeEmbedUrl(
  id: string,
  opts: { autoplay?: boolean; mute?: boolean } = {},
): string {
  const params = new URLSearchParams()
  if (opts.autoplay) params.set('autoplay', '1')
  if (opts.mute) params.set('mute', '1')
  const qs = params.toString()
  return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ''}`
}
```

- [ ] **Step 4: Write the thumbnail helper**

Create `lib/tv/thumbnail.ts`:

```ts
import { parseYouTubeId } from '@/lib/matches/youtube'

// A YouTube video's default thumbnail. Returns null when the URL isn't a YouTube link.
export function youtubeThumbnail(url: string | null): string | null {
  const id = parseYouTubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/tv/thumbnail.test.ts lib/matches/youtube.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/youtube.ts lib/matches/youtube.test.ts lib/tv/thumbnail.ts lib/tv/thumbnail.test.ts
git commit -m "feat: muted-embed option + youtubeThumbnail helper (#11)"
```

---

### Task 3: TV video schema + categories

**Files:**
- Create: `lib/tv/schema.ts`
- Test: `lib/tv/schema.test.ts`

**Interfaces:**
- Produces: `TV_CATEGORIES`, `TvCategory`, `CATEGORY_LABELS`, `tvVideoSchema`, `TvVideoInput`. Consumed by Tasks 4, 6.

- [ ] **Step 1: Write the failing test**

Create `lib/tv/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tvVideoSchema } from './schema'

const valid = {
  title: 'Insane comeback',
  category: 'highlight',
  youtubeUrl: 'https://youtu.be/abcdefghijk',
  description: '',
  thumbnailUrl: '',
}

describe('tvVideoSchema', () => {
  it('accepts a valid video', () => {
    expect(tvVideoSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a non-YouTube URL', () => {
    expect(tvVideoSchema.safeParse({ ...valid, youtubeUrl: 'https://vimeo.com/1' }).success).toBe(false)
  })
  it('rejects an unknown category', () => {
    expect(tvVideoSchema.safeParse({ ...valid, category: 'meme' }).success).toBe(false)
  })
  it('rejects an empty title', () => {
    expect(tvVideoSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tv/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the implementation**

Create `lib/tv/schema.ts`:

```ts
import { z } from 'zod'
import { parseYouTubeId } from '@/lib/matches/youtube'

export const TV_CATEGORIES = ['highlight', 'interview', 'recap', 'best_goal'] as const
export type TvCategory = (typeof TV_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<TvCategory, string> = {
  highlight: 'Highlight',
  interview: 'Interview',
  recap: 'Recap',
  best_goal: 'Best Goal',
}

export const tvVideoSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(TV_CATEGORIES),
  youtubeUrl: z.string().trim().refine((v) => parseYouTubeId(v) !== null, 'Enter a valid YouTube link'),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
  thumbnailUrl: z.union([z.literal(''), z.string().trim().url('Enter a valid URL')]).optional(),
})

export type TvVideoInput = z.infer<typeof tvVideoSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tv/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tv/schema.ts lib/tv/schema.test.ts
git commit -m "feat: tv video schema + categories (#11)"
```

---

### Task 4: TV video components

**Files:**
- Create: `components/tv/VideoModal.tsx`
- Create: `components/tv/VideoCard.tsx`
- Create: `components/tv/MatchVideoCard.tsx`

**Interfaces:**
- Consumes: `youtubeEmbedUrl`, `parseYouTubeId` (Task 2); `youtubeThumbnail` (Task 2); `CATEGORY_LABELS`, `TvCategory` (Task 3).
- Produces: `<VideoModal videoId title onClose />`; `CuratedVideo` type + `<VideoCard video />`; `MatchVideo` type + `<MatchVideoCard video />`. Consumed by Task 5.

- [ ] **Step 1: VideoModal (responsive overlay, muted autoplay)**

Create `components/tv/VideoModal.tsx`:

```tsx
'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { youtubeEmbedUrl } from '@/lib/matches/youtube'

export function VideoModal({
  videoId,
  title,
  onClose,
}: {
  videoId: string
  title: string
  onClose: () => void
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-3xl sm:px-4">
        <div className="overflow-hidden rounded-t-2xl border border-slate-800 bg-slate-950 sm:rounded-2xl">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <p className="truncate text-sm font-bold text-white">{title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative aspect-video w-full">
            <iframe
              src={youtubeEmbedUrl(videoId, { autoplay: true, mute: true })}
              title={title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: VideoCard (curated → opens the overlay)**

Create `components/tv/VideoCard.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { Play } from 'lucide-react'
import { parseYouTubeId } from '@/lib/matches/youtube'
import { youtubeThumbnail } from '@/lib/tv/thumbnail'
import { CATEGORY_LABELS, type TvCategory } from '@/lib/tv/schema'
import { VideoModal } from '@/components/tv/VideoModal'

export interface CuratedVideo {
  id: string
  title: string
  category: TvCategory
  youtubeUrl: string
  thumbnailUrl: string | null
}

export function VideoCard({ video }: { video: CuratedVideo }) {
  const [open, setOpen] = useState(false)
  const ytId = parseYouTubeId(video.youtubeUrl)
  if (!ytId) return null
  const thumb = video.thumbnailUrl ?? youtubeThumbnail(video.youtubeUrl)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="h-10 w-10 text-white" />
          </span>
          <span className="absolute left-2 top-2 rounded-full bg-violet-600/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            {CATEGORY_LABELS[video.category]}
          </span>
        </div>
        <p className="mt-1.5 truncate text-sm font-semibold text-white">{video.title}</p>
      </button>
      {open && <VideoModal videoId={ytId} title={video.title} onClose={() => setOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 3: MatchVideoCard (match-derived → links to Match Centre)**

Create `components/tv/MatchVideoCard.tsx`:

```tsx
import Link from 'next/link'
import { Play } from 'lucide-react'

export interface MatchVideo {
  id: string
  title: string
  subtitle: string | null
  thumbnailUrl: string | null
  isLive?: boolean
}

export function MatchVideoCard({ video }: { video: MatchVideo }) {
  return (
    <Link href={`/matches/${video.id}`} className="group block">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {video.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-10 w-10 text-white" />
        </span>
        {video.isLive && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-white">{video.title}</p>
      {video.subtitle && <p className="truncate text-xs text-slate-500">{video.subtitle}</p>}
    </Link>
  )
}
```

- [ ] **Step 4: Build + commit**

Run: `npm run build`
Expected: compiles (components unused until Task 5).

```bash
git add components/tv/VideoModal.tsx components/tv/VideoCard.tsx components/tv/MatchVideoCard.tsx
git commit -m "feat: TV video components — overlay player + cards (#11)"
```

---

### Task 5: The `/tv` page

**Files:**
- Create: `app/(public)/tv/page.tsx`
- Delete: `app/(public)/tv/.gitkeep`

**Interfaces:**
- Consumes: Task 4 components + types; `youtubeThumbnail` (Task 2); `CATEGORY_LABELS` not needed here; `createClient`; `VideoEmbed`; `EmptyState`.

- [ ] **Step 1: Write the page**

Create `app/(public)/tv/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { VideoEmbed } from '@/components/match/VideoEmbed'
import { EmptyState } from '@/components/shared/EmptyState'
import { VideoCard, type CuratedVideo } from '@/components/tv/VideoCard'
import { MatchVideoCard, type MatchVideo } from '@/components/tv/MatchVideoCard'
import { youtubeThumbnail } from '@/lib/tv/thumbnail'
import type { TvCategory } from '@/lib/tv/schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Sentinel X TV — Live, Highlights & Replays',
  description: 'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.',
  openGraph: {
    title: 'Sentinel X TV',
    description: 'Live mobile esports, highlights, finals, and replays.',
    url: `${SITE_URL}/tv`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

const MATCH_COLS =
  'id, status, round, score_a, score_b, youtube_stream_url, replay_url, completed_at, ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
  'tournament:tournaments(title)'

type NameRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'TBD'
}
type TitleRef = { title: string } | { title: string }[] | null
function titleOf(x: TitleRef): string | null {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? null
}

type MatchRow = {
  id: string
  status: string
  round: string
  score_a: number | null
  score_b: number | null
  youtube_stream_url: string | null
  replay_url: string | null
  completed_at: string | null
  player_a: NameRef
  player_b: NameRef
  tournament: TitleRef
}

function toMatchVideo(m: MatchRow, live: boolean): MatchVideo {
  const a = nameOf(m.player_a)
  const b = nameOf(m.player_b)
  const scored = m.score_a != null && m.score_b != null
  const t = titleOf(m.tournament)
  const subtitle = scored ? `${t ? `${t} · ` : ''}${m.score_a}–${m.score_b}` : t
  return {
    id: m.id,
    title: `${a} vs ${b}`,
    subtitle,
    thumbnailUrl: youtubeThumbnail(live ? m.youtube_stream_url : m.replay_url),
    isLive: live,
  }
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-base font-bold text-white">{children}</h2>
}

export default async function TvPage() {
  const supabase = createClient()
  const [{ data: liveRaw }, { data: curatedRaw }, { data: finalsRaw }, { data: replaysRaw }] =
    await Promise.all([
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('status', 'live')
        .not('youtube_stream_url', 'is', null)
        .order('updated_at', { ascending: false }),
      supabase
        .from('tv_videos')
        .select('id, title, youtube_url, category, thumbnail_url')
        .eq('active', true)
        .order('published_at', { ascending: false }),
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('round', 'final')
        .eq('status', 'completed')
        .not('replay_url', 'is', null)
        .order('completed_at', { ascending: false }),
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('status', 'completed')
        .not('replay_url', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(12),
    ])

  const live = (liveRaw ?? []) as unknown as MatchRow[]
  const finals = (finalsRaw ?? []) as unknown as MatchRow[]
  const replays = (replaysRaw ?? []) as unknown as MatchRow[]
  const curated: CuratedVideo[] = (curatedRaw ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    category: v.category as TvCategory,
    youtubeUrl: v.youtube_url,
    thumbnailUrl: v.thumbnail_url,
  }))

  const hero = live[0] ?? null
  const isEmpty = live.length === 0 && curated.length === 0 && finals.length === 0 && replays.length === 0

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Sentinel X TV</h1>
        <p className="mt-1 text-sm text-slate-400">Live matches, highlights, finals, and replays.</p>
      </div>

      {isEmpty && (
        <EmptyState icon="📺" title="Nothing on air yet" body="Live matches and replays will show up here." />
      )}

      {hero && (
        <section>
          <SectionTitle>🔴 Live Now</SectionTitle>
          <VideoEmbed streamUrl={hero.youtube_stream_url} replayUrl={null} isLive />
          <Link href={`/matches/${hero.id}`} className="mt-2 inline-block text-sm font-semibold text-violet-400 hover:text-violet-300">
            {nameOf(hero.player_a)} vs {nameOf(hero.player_b)} — open Match Centre →
          </Link>
          {live.length > 1 && (
            <div className="mt-4">
              <Grid>
                {live.slice(1).map((m) => (
                  <MatchVideoCard key={m.id} video={toMatchVideo(m, true)} />
                ))}
              </Grid>
            </div>
          )}
        </section>
      )}

      {curated.length > 0 && (
        <section>
          <SectionTitle>Highlights</SectionTitle>
          <Grid>
            {curated.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </Grid>
        </section>
      )}

      {finals.length > 0 && (
        <section>
          <SectionTitle>Finals</SectionTitle>
          <Grid>
            {finals.map((m) => (
              <MatchVideoCard key={m.id} video={toMatchVideo(m, false)} />
            ))}
          </Grid>
        </section>
      )}

      {replays.length > 0 && (
        <section>
          <SectionTitle>All Replays</SectionTitle>
          <Grid>
            {replays.map((m) => (
              <MatchVideoCard key={m.id} video={toMatchVideo(m, false)} />
            ))}
          </Grid>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remove the route stub**

```bash
git rm "app/(public)/tv/.gitkeep"
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; `/tv` appears in the route list. (If a match embed select trips the type parser, the `as unknown as MatchRow[]` casts already handle it — same pattern as the profile page.)

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/tv/page.tsx"
git commit -m "feat: /tv page — live, highlights, finals, replays (#11)"
```

---

### Task 6: Admin TV surface

**Files:**
- Create: `lib/tv/admin-actions.ts`
- Create: `components/admin/TvVideoForm.tsx`
- Create: `components/admin/TvVideoRow.tsx`
- Create: `app/admin/tv/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `tvVideoSchema`, `TV_CATEGORIES`, `CATEGORY_LABELS` (Task 3); `requireStaff` (`@/lib/admin/auth`); `createClient` (`@/lib/supabase/server`).
- Produces: `addVideo`, `updateVideo`, `toggleVideoActive`, `deleteVideo` (`(prev, FormData) => Promise<TvVideoState>`); `TvVideoState`; `<TvVideoForm>`, `<TvVideoRow>`.

- [ ] **Step 1: Server actions**

Create `lib/tv/admin-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { tvVideoSchema } from './schema'

export type TvVideoState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return tvVideoSchema.safeParse({
    title: formData.get('title') ?? '',
    category: formData.get('category') ?? '',
    youtubeUrl: formData.get('youtubeUrl') ?? '',
    description: formData.get('description') ?? '',
    thumbnailUrl: formData.get('thumbnailUrl') ?? '',
  })
}
function revalidate() {
  revalidatePath('/tv')
  revalidatePath('/admin/tv')
}

export async function addVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  const ctx = await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').insert({
    title: d.title,
    category: d.category,
    youtube_url: d.youtubeUrl,
    description: d.description || null,
    thumbnail_url: d.thumbnailUrl || null,
    created_by: ctx.userId,
  })
  if (error) return { error: 'Could not save the video. Please try again.' }
  revalidate()
  return { success: true }
}

export async function updateVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing video.' }
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase
    .from('tv_videos')
    .update({
      title: d.title,
      category: d.category,
      youtube_url: d.youtubeUrl,
      description: d.description || null,
      thumbnail_url: d.thumbnailUrl || null,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the video.' }
  revalidate()
  return { success: true }
}

export async function toggleVideoActive(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const currentlyActive = String(formData.get('active') ?? '') === 'true'
  if (!id) return { error: 'Missing video.' }
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').update({ active: !currentlyActive }).eq('id', id)
  if (error) return { error: 'Could not update visibility.' }
  revalidate()
  return { success: true }
}

export async function deleteVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing video.' }
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').delete().eq('id', id)
  if (error) return { error: 'Could not delete the video.' }
  revalidate()
  return { success: true }
}
```

- [ ] **Step 2: The add/edit form**

Create `components/admin/TvVideoForm.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { addVideo, updateVideo, type TvVideoState } from '@/lib/tv/admin-actions'
import { TV_CATEGORIES, CATEGORY_LABELS } from '@/lib/tv/schema'

export interface TvVideoDefaults {
  id?: string
  title?: string
  category?: string
  youtubeUrl?: string
  description?: string
  thumbnailUrl?: string
}

export function TvVideoForm({ defaults, onDone }: { defaults?: TvVideoDefaults; onDone?: () => void }) {
  const editing = Boolean(defaults?.id)
  const action = editing ? updateVideo : addVideo
  const [state, formAction] = useFormState<TvVideoState, FormData>(action, undefined)
  if (state?.success && onDone) onDone()

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}
      <Field label="Title" name="title" defaultValue={defaults?.title} required />
      <div className="space-y-1.5">
        <label htmlFor="category" className="text-xs font-medium text-slate-400">Category</label>
        <select
          id="category"
          name="category"
          defaultValue={defaults?.category ?? 'highlight'}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          {TV_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <Field label="YouTube URL" name="youtubeUrl" type="url" defaultValue={defaults?.youtubeUrl} placeholder="https://youtu.be/…" required />
      <Field label="Description (optional)" name="description" defaultValue={defaults?.description} />
      <div className="flex items-center gap-2">
        <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
          {editing ? 'Save changes' : 'Add video'}
        </button>
        {state?.success && <span className="text-xs text-emerald-400">Saved.</span>}
        {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 3: The list row (hide / delete / edit toggle)**

Create `components/admin/TvVideoRow.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { toggleVideoActive, deleteVideo, type TvVideoState } from '@/lib/tv/admin-actions'
import { CATEGORY_LABELS, type TvCategory } from '@/lib/tv/schema'
import { TvVideoForm } from '@/components/admin/TvVideoForm'

export interface AdminTvVideo {
  id: string
  title: string
  category: TvCategory
  youtubeUrl: string
  description: string | null
  active: boolean
}

export function TvVideoRow({ video }: { video: AdminTvVideo }) {
  const [editing, setEditing] = useState(false)
  const [toggleState, toggleAction] = useFormState<TvVideoState, FormData>(toggleVideoActive, undefined)
  const [deleteState, deleteAction] = useFormState<TvVideoState, FormData>(deleteVideo, undefined)

  if (editing) {
    return (
      <div className="space-y-2">
        <TvVideoForm
          defaults={{
            id: video.id,
            title: video.title,
            category: video.category,
            youtubeUrl: video.youtubeUrl,
            description: video.description ?? '',
          }}
          onDone={() => setEditing(false)}
        />
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-white">
          Cancel edit
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">
          {video.title}
          {!video.active && <span className="ml-2 text-[11px] font-semibold text-slate-500">(hidden)</span>}
        </p>
        <p className="text-xs text-slate-500">{CATEGORY_LABELS[video.category]}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
          Edit
        </button>
        <form action={toggleAction}>
          <input type="hidden" name="id" value={video.id} />
          <input type="hidden" name="active" value={String(video.active)} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
            {video.active ? 'Hide' : 'Unhide'}
          </button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={video.id} />
          <button type="submit" className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">
            Delete
          </button>
        </form>
      </div>
      {(toggleState?.error || deleteState?.error) && (
        <span className="text-xs text-red-400">{toggleState?.error ?? deleteState?.error}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: The admin page**

Create `app/admin/tv/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { TvVideoForm } from '@/components/admin/TvVideoForm'
import { TvVideoRow, type AdminTvVideo } from '@/components/admin/TvVideoRow'
import type { TvCategory } from '@/lib/tv/schema'
import { EmptyState } from '@/components/shared/EmptyState'

export const metadata: Metadata = { title: 'TV · Admin · SentinelX' }

export default async function AdminTvPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('tv_videos')
    .select('id, title, category, youtube_url, description, active')
    .order('published_at', { ascending: false })

  const videos: AdminTvVideo[] = (data ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    category: v.category as TvCategory,
    youtubeUrl: v.youtube_url,
    description: v.description,
    active: v.active,
  }))

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Sentinel X TV</h1>
      <div className="mb-8">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">Add a video</h2>
        <TvVideoForm />
      </div>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">Videos</h2>
      {videos.length === 0 ? (
        <EmptyState icon="📺" title="No videos yet" body="Add a YouTube clip above to feature it on TV." />
      ) : (
        <div className="space-y-2">
          {videos.map((v) => (
            <TvVideoRow key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add the admin nav entry**

In `lib/admin/nav.ts`, add to the `ADMIN_NAV` array (after `Results`):

```ts
  { label: 'TV', href: '/admin/tv', adminOnly: false },
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: compiles; `/admin/tv` in the route list.

```bash
git add lib/tv/admin-actions.ts components/admin/TvVideoForm.tsx components/admin/TvVideoRow.tsx app/admin/tv/page.tsx lib/admin/nav.ts
git commit -m "feat: /admin/tv — curated video CRUD (#11)"
```

---

### Task 7: Wire the Watch pillar to /tv

**Files:**
- Modify: `lib/nav/tabs.ts`
- Modify: `lib/nav/tabs.test.ts`
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:** consumes the `/tv` route.

- [ ] **Step 1: Update the failing test first**

In `lib/nav/tabs.test.ts`, replace the `describe('isTabActive', ...)` block's coming-soon test and add a TV test. Change:

```ts
  it('marks a coming-soon tab active only for its feature', () => {
    expect(isTabActive(watch, '/coming-soon', 'Watch')).toBe(true)
    expect(isTabActive(watch, '/coming-soon', 'Trade')).toBe(false)
    expect(isTabActive(watch, '/tournaments', 'Watch')).toBe(false)
  })
```

to:

```ts
  it('marks a coming-soon tab active only for its feature', () => {
    const community = PILLAR_TABS.find((t) => t.key === 'community')!
    expect(isTabActive(community, '/coming-soon', 'Community')).toBe(true)
    expect(isTabActive(community, '/coming-soon', 'Trade')).toBe(false)
    expect(isTabActive(community, '/tournaments', 'Community')).toBe(false)
  })

  it('marks the Watch tab active on /tv (real page, not coming-soon)', () => {
    expect(isTabActive(watch, '/tv', null)).toBe(true)
    expect(isTabActive(watch, '/coming-soon', 'Watch')).toBe(false)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: FAIL — the Watch tab still points at coming-soon, so `isTabActive(watch, '/tv', null)` is false.

- [ ] **Step 3: Point the Watch tab at /tv**

In `lib/nav/tabs.ts`, change the `watch` entry in `PILLAR_TABS` from:

```ts
  { key: 'watch', label: 'Watch', href: '/coming-soon?feature=Watch', feature: 'Watch', match: null },
```

to:

```ts
  { key: 'watch', label: 'Watch', href: '/tv', feature: null, match: '/tv' },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Add TV to the desktop header nav**

In `components/shared/SiteHeader.tsx`, change the `NAV` array from:

```ts
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/rankings', label: 'Rankings' },
]
```

to:

```ts
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/tv', label: 'TV' },
  { href: '/rankings', label: 'Rankings' },
]
```

- [ ] **Step 6: Commit**

```bash
git add lib/nav/tabs.ts lib/nav/tabs.test.ts components/shared/SiteHeader.tsx
git commit -m "feat: wire Watch pillar + header to /tv (#11)"
```

---

### Task 8: Full verification + push

**Files:** none.

- [ ] **Step 1: Full test + type gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (incl. new tv helper tests + updated tabs test); no type errors.

- [ ] **Step 2: Single clean build**

Run **one** build (no other build/dev running): `npm run build`
Expected: exit 0; route list includes `/tv` and `/admin/tv`. If it errors with `ENOENT ... 500.html`, run `rm -rf .next` and rebuild once.

- [ ] **Step 3: Live smoke test**

Start the built server (`npm run start`), then with `curl` (public page needs no auth):
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/tv` → **200**; the page shows "Nothing on air yet" given no live/curated/replay data yet (correct for current live state).
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/tv` → **307/302** redirect to `/login` (unauthenticated is bounced by middleware/`requireStaff`).
Stop the server afterward.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** §2 table+RLS → Task 1; §2 match-derived sources → Task 5 queries; §3 page sections + order + empty state → Task 5; §3/§4 interaction model (curated overlay vs match link) → Tasks 4–5; §4 muted autoplay → Task 2 (`youtubeEmbedUrl`) + Task 4 (`VideoModal`); §5 admin CRUD + nav → Task 6; §6 helpers + tests → Tasks 2–3; §7 wiring + SEO → Tasks 5 (metadata) + 7; §8 scope respected (no playlists/views/scheduling/pagination). All covered.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `CuratedVideo`/`MatchVideo` (Task 4) are built and consumed with identical fields in Task 5. `TvVideoState` + the four action signatures (Task 6) match their `useFormState` usage in the form/row. `AdminTvVideo`/`TvVideoDefaults` fields line up between `TvVideoRow` and `TvVideoForm`. `tvVideoSchema` field names (`title`/`category`/`youtubeUrl`/`description`/`thumbnailUrl`, Task 3) match the `formData.get(...)` keys in the actions and the form input `name`s. The `watch` tab shape change (Task 7) is matched by the updated test in the same task. `youtubeEmbedUrl` new signature (Task 2) is called with `{autoplay,mute}` only in `VideoModal`; the existing `VideoEmbed` call `youtubeEmbedUrl(id)` stays valid (opts optional).
- **Embedded-join note:** the `/tv` match queries use the two-`profiles`-FK + `tournaments` embed that trips the Supabase type parser; handled with `as unknown as MatchRow[]` (same pattern as the profile page). The single-table `tv_videos` selects type cleanly after the Task 1 regen.
