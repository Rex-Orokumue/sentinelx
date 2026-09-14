# Media-First Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Piece 4 of the community rebuild — real multi-image posts (up to 5 images), a media-first restructure of the feed's post cards with a swipeable carousel, and a three-column image grid on player profiles.

**Architecture:** `community_post_images` must be **recreated** — it existed once (`017_community_login_gate_and_images.sql`) but was dropped by `056_phase3_social_feed.sql` (the Phase 3 Social Feed rebuild), which kept only a single `community_posts.image_url` column and migrated forward just the first image of each old post. Nothing since has recreated it, so this plan adds it back as a genuinely new migration. `createPost` writes the first image to the legacy `image_url` column (unchanged consumers — `CommunityGallery`, `AnnouncementCard`, admin — keep working) and bulk-inserts the rest into `community_post_images`. `hydratePosts` (shared by the feed list and post-detail) batches a read of that table and exposes a new `PostView.imageUrls: string[]`, falling back to `[imageUrl]` for pre-existing single-image posts. `PostCard`'s manual/achievement card gets a media-first restructure — full-bleed image(s) under the header, caption below — via a new `PostMediaCarousel` (scroll-snap + dots, reusing the existing `ImageLightbox`). A new `ProfileImageGrid` adds a 3-column square gallery to player profiles. `match_result`/`announcement` cards, `FeedList.tsx`, `FeedFilters.tsx`, `CommunityGallery.tsx`, and `ProfileHeader.tsx` are untouched — the last four are the concurrent Follows (Piece 3) session's likely surface.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Storage), Tailwind, `zod`, `vitest`, `lucide-react`.

**Spec:**
- `docs/superpowers/specs/2026-09-07-media-feed-design.md` (this piece, including the 2026-09-13 addendum — the addendum supersedes the doc's original "What exists" section)
- `docs/superpowers/specs/2026-09-07-community-system-overview.md` (cross-cutting rules)

## Global Constraints

- **Mobile-first.** Design at 375px, scale up.
- **RLS on every table.** `community_post_images` is public-read (posts are publicly readable per `community_posts_read` in `056_phase3_social_feed.sql`); insert/delete require the requester to be the post's `author_id` or staff (`public.is_staff()`) — same shape as the original `017` policies.
- **Max 5 images per post, server-validated.** Never trust a client-sent count — `clampImageUrls` (Task 2) is the one place this is enforced.
- **Storage path convention.** `community-images` bucket INSERT policy (`016_community.sql`) requires the uploader's UID as the **first** path segment. Each image uploads to `${userId}/${uuid}.jpg` — same shape the current single-image composer already uses, just once per file now.
- **Migrations are timestamp-named.** `YYYYMMDDHHMMSS_name.sql` (UTC). Latest existing migration is `20260913120000_dm_stickers_audio_forward.sql`; the concurrent Follows session's plan claims `20260913150000_player_follows.sql`. This plan uses `20260913160000_community_post_images.sql` to stay clear of both.
- **Supabase project id for type generation:** `itxubrkbropttfdackmi`.
- **Do not touch** `FeedList.tsx`, `FeedFilters.tsx`, `CommunityGallery.tsx`, `ProfileHeader.tsx`, or add a `player_follows` migration — the concurrent Follows (Piece 3) session's likely surface. (Note: at execution time, Follows had already merged to `main` — see Task 8 execution note about the profile page having drifted since this plan was written.)
- **`match_result` and `announcement` post cards are untouched.** Only the manual/achievement card (`ManualOrAchievementCard` inside `PostCard.tsx`) gets the media-first restructure.
- **Text-only posts keep today's treatment unchanged** — a media-first layout with no media is just a worse text post (spec).
- **Letterbox, never crop, in the feed card.** `object-contain` on a bounded-height box for the carousel/single image — this is the exact class of bug that hit the game cards from a fixed-height `object-cover` crop. Cropping to square **is** fine in the profile grid — that's what a grid is (spec).
- **Only pure logic gets unit tests** — matches the existing `lib/community/*` convention (`boost.test.ts`, `gallery-query.test.ts`, etc: query/action functions and all UI get manual end-to-end verification instead of Supabase mocking).
- **Concurrent session active in this primary checkout** (`C:/Users/gorok/Videos/sentinelx`) building Follows. Work in an isolated worktree/branch, not `feat/dm-inbox-polish`. Do not run `npm run build` locally while another session's `next dev` may be running — verify with `npx tsc --noEmit` + `npx next lint` + `npm run test`, and check the Vercel preview build after push.
- **Out of scope (spec "Scope for v1"):** filters and editing, alt text authoring, video, upload-time cropping to a fixed aspect ratio, saved/bookmarked posts, `community_reply_images` (replies stay single-image via whatever they use today — not touched by this plan).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260913160000_community_post_images.sql` | Recreates `community_post_images` table + RLS |
| `lib/community/schema.test.ts` | Unit tests for `clampImageUrls` |
| `components/community/PostMediaCarousel.tsx` | `'use client'` — scroll-snap + dots carousel, opens `ImageLightbox` on tap |
| `components/player/ProfileImageGrid.tsx` | 3-column square image grid, tap-through to `/community/{id}` |

**Modified files:**

| Path | Change |
|---|---|
| `lib/supabase/types.ts` | Regenerated after the migration is applied |
| `lib/community/schema.ts` | Adds `MAX_POST_IMAGES` + `clampImageUrls` |
| `lib/community/post-actions.ts` | `createPost` takes `imageUrls: string[]`, writes first to `image_url`, rest to `community_post_images` |
| `lib/community/feed-query.ts` | `hydratePosts` batches `community_post_images`; `PostView` gains `imageUrls: string[]` |
| `components/community/PostComposer.tsx` | Multi-file picker (cap 5), thumbnail strip, uploads each file, calls `createPost` with `imageUrls` |
| `components/community/PostCard.tsx` | `ManualOrAchievementCard` media-first restructure using `PostMediaCarousel` |
| `app/[locale]/(public)/players/[username]/page.tsx` | New query for the author's image posts (cap 18), renders `ProfileImageGrid` |

---

## Task 1: Schema — `community_post_images` table, apply, regenerate types

**Files:**
- Create: `supabase/migrations/20260913160000_community_post_images.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `public.community_post_images` table live in production; `Database['public']['Tables']['community_post_images']` in `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260913160000_community_post_images.sql`:

```sql
-- Media-first feed — Piece 4 of 4 of the community rebuild (see
-- docs/superpowers/specs/2026-09-07-media-feed-design.md, 2026-09-13 addendum).
--
-- community_post_images existed once (017_community_login_gate_and_images.sql)
-- but was DROPPED by 056_phase3_social_feed.sql, the Phase 3 Social Feed
-- rebuild that replaced the whole v3.6 community schema — only each post's
-- first image was migrated forward into today's single community_posts.image_url
-- column. Nothing since recreated it, and nothing ever wrote to it as "posts
-- support one image" shipped instead. This recreates it, same shape as 017.
--
-- image_url stays the single source of truth for a post's FIRST image (every
-- existing reader — CommunityGallery, AnnouncementCard, admin — keeps working
-- unchanged); this table holds images 2-5, ordered by display_order.

CREATE TABLE public.community_post_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_post_images (post_id, display_order);

ALTER TABLE public.community_post_images ENABLE ROW LEVEL SECURITY;

-- Public read — matches community_posts_read (056), which is public, not
-- auth-gated like the original 017 policy was.
CREATE POLICY "cpi_select" ON public.community_post_images FOR SELECT USING (true);

CREATE POLICY "cpi_insert" ON public.community_post_images FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = post_id AND (p.author_id = auth.uid() OR public.is_staff())
  )
);

CREATE POLICY "cpi_delete" ON public.community_post_images FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = post_id AND (p.author_id = auth.uid() OR public.is_staff())
  )
);
```

- [ ] **Step 2: Apply the migration to production**

- **Preferred (MCP):** Supabase `apply_migration` tool, name `20260913160000_community_post_images`.
- **Or CLI from `C:/Users/gorok/Videos/sentinelx`:** `npx supabase db push` (intermittently unreachable on this machine — see memory `project_supabase_connectivity_gotcha`; prefer MCP).

If neither is available, **stop and ask the user to apply it** — every later task depends on the table existing.

- [ ] **Step 3: Verify in production**

Run via MCP `execute_sql` (or `npx supabase db execute`):

```sql
SELECT to_regclass('public.community_post_images') AS community_post_images;
SELECT polname FROM pg_policy
WHERE polrelid = 'public.community_post_images'::regclass
ORDER BY polname;
```

Expected: `community_post_images` non-null; policies are exactly `cpi_delete`, `cpi_insert`, `cpi_select`.

- [ ] **Step 4: Regenerate types**

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

```bash
grep -c "community_post_images:" lib/supabase/types.ts   # expect 1
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260913160000_community_post_images.sql lib/supabase/types.ts
git commit -m "feat(community): recreate community_post_images table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 2: Pure logic — `clampImageUrls` (TDD)

**Files:**
- Modify: `lib/community/schema.ts`
- Create: `lib/community/schema.test.ts`

**Interfaces:**
- Produces: `MAX_POST_IMAGES: number`, `clampImageUrls(urls: string[]): string[]`.
- Consumed by: `lib/community/post-actions.ts` (Task 3), `components/community/PostComposer.tsx` (Task 5, for `MAX_POST_IMAGES` only).

- [ ] **Step 1: Write the failing tests**

Create `lib/community/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MAX_POST_IMAGES, clampImageUrls } from './schema'

describe('MAX_POST_IMAGES', () => {
  it('is 5', () => {
    expect(MAX_POST_IMAGES).toBe(5)
  })
})

describe('clampImageUrls', () => {
  it('passes through a list under the cap unchanged', () => {
    expect(clampImageUrls(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('caps a list over the max at 5, keeping order', () => {
    const urls = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(clampImageUrls(urls)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('trims whitespace on each url', () => {
    expect(clampImageUrls(['  a  ', 'b\n'])).toEqual(['a', 'b'])
  })

  it('drops blank/whitespace-only entries', () => {
    expect(clampImageUrls(['a', '   ', '', 'b'])).toEqual(['a', 'b'])
  })

  it('returns an empty array for an empty input', () => {
    expect(clampImageUrls([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/community/schema.test.ts`
Expected: FAIL — `MAX_POST_IMAGES`/`clampImageUrls` not exported.

- [ ] **Step 3: Implement**

Add to `lib/community/schema.ts` (after the existing `postContentSchema` export, before `commentContentSchema`):

```ts
// A post carries at most this many images (addendum, spec §"Changes"). The
// server-side twin of the composer's own cap — never trust a client-sent
// count.
export const MAX_POST_IMAGES = 5

export function clampImageUrls(urls: string[]): string[] {
  return urls
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .slice(0, MAX_POST_IMAGES)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/community/schema.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/community/schema.ts lib/community/schema.test.ts
git commit -m "feat(community): MAX_POST_IMAGES + clampImageUrls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 3: `createPost` — multi-image write path

**Files:**
- Modify: `lib/community/post-actions.ts:14-44` (the `createPost` function)

**Interfaces:**
- Consumes: `clampImageUrls` from `lib/community/schema.ts` (Task 2).
- Produces: `createPost(input: { content: string; imageUrls?: string[] }): Promise<{ id?: string; error?: string }>` — signature change from today's `{ content: string; imageUrl?: string | null }`.
- Consumed by: `components/community/PostComposer.tsx` (Task 5).

No TDD here — a server action against live Supabase, verified end-to-end in Task 9 (existing convention: `post-actions.ts` has no test file today).

- [ ] **Step 1: Update the import and function**

In `lib/community/post-actions.ts`, add the import and replace `createPost`:

```ts
import { postContentSchema, clampImageUrls } from './schema'
```

```ts
// A post needs text or an image, not neither (spec §6 "Empty post ... Post
// button disabled" — this is the server-side twin of that client check). Up
// to 5 images: the first is written to the legacy community_posts.image_url
// column (every existing reader — CommunityGallery, AnnouncementCard, admin —
// keeps working unchanged); the rest go to community_post_images.
export async function createPost(input: { content: string; imageUrls?: string[] }): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const parsed = postContentSchema.safeParse(input.content)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const content = parsed.data
  const imageUrls = clampImageUrls(input.imageUrls ?? [])
  const firstImageUrl = imageUrls[0] ?? null
  if (!content && !firstImageUrl) return { error: 'Write something or add a screenshot first.' }

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({ author_id: user.id, content, image_url: firstImageUrl, post_type: 'manual' })
    .select('id')
    .single()
  if (error || !post) {
    console.error('[createPost] community_posts insert failed', { authorId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post. Please try again.' }
  }

  if (imageUrls.length > 1) {
    const extraImages = imageUrls.slice(1).map((image_url, i) => ({
      post_id: post.id,
      image_url,
      display_order: i + 1,
    }))
    const { error: imagesError } = await supabase.from('community_post_images').insert(extraImages)
    // Don't fail the post over this — the post itself succeeded and has its
    // first image; a partial-image post is a smaller problem than losing the
    // player's post entirely.
    if (imagesError) {
      console.error('[createPost] community_post_images insert failed', { postId: post.id, code: imagesError.code, message: imagesError.message })
    }
  }

  // Weekly "Community Voice" challenge — needs the service-role client since
  // player_challenge_progress has no client write policy (system-only writes).
  const admin = createAdminClient()
  await incrementChallenge(admin, user.id, 'post_created')

  revalidatePath('/community')
  return { id: post.id }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (any remaining caller of the old `{ imageUrl }` shape will now error — Task 5 updates the only caller, `PostComposer.tsx`).

- [ ] **Step 3: Commit**

```bash
git add lib/community/post-actions.ts
git commit -m "feat(community): createPost writes multi-image posts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 4: `hydratePosts` — multi-image read path

**Files:**
- Modify: `lib/community/feed-query.ts:32-50` (`PostView` interface), `lib/community/feed-query.ts:97-192` (`hydratePosts`)

**Interfaces:**
- Produces: `PostView.imageUrls: string[]` (new field; `imageUrl: string | null` is unchanged and still populated).
- Consumed by: `components/community/PostCard.tsx` (Task 7).

No TDD here — same convention as Task 3; `hydratePosts` is exercised by the existing manual verification of `/community` and `/community/[id]`, extended in Task 9.

- [ ] **Step 1: Add `imageUrls` to `PostView`**

In `lib/community/feed-query.ts`, add one field to the `PostView` interface (right after `imageUrl`):

```ts
export interface PostView {
  id: string
  postType: PostType
  content: string
  imageUrl: string | null
  imageUrls: string[]
  referenceId: string | null
  isPinned: boolean
  boostedUntil: string | null
  createdAt: string
  author: PlayerRef
  canDelete: boolean
  canBoost: boolean
  reactionCounts: Record<ReactionType, number>
  myReaction: ReactionType | null
  commentCount: number
  matchResult: MatchResultDetail | null
  // Whether the viewer has silenced push about this thread (migration 082).
  mutedByViewer: boolean
}
```

- [ ] **Step 2: Batch-fetch `community_post_images` inside `hydratePosts`**

In `hydratePosts`, add a third query to the existing `Promise.all` and build a lookup map. Replace:

```ts
  const [{ data: reactions }, { data: comments }] = await Promise.all([
    supabase.from('post_reactions').select('post_id, player_id, reaction').in('post_id', postIds),
    supabase.from('post_comments').select('post_id').in('post_id', postIds).eq('is_deleted', false),
  ])
```

with:

```ts
  const [{ data: reactions }, { data: comments }, { data: extraImages }] = await Promise.all([
    supabase.from('post_reactions').select('post_id, player_id, reaction').in('post_id', postIds),
    supabase.from('post_comments').select('post_id').in('post_id', postIds).eq('is_deleted', false),
    // Images 2-5 only — a post's first image lives on community_posts.image_url
    // itself (createPost, lib/community/post-actions.ts).
    supabase
      .from('community_post_images')
      .select('post_id, image_url, display_order')
      .in('post_id', postIds)
      .order('display_order', { ascending: true }),
  ])

  const extraImagesByPost = new Map<string, string[]>()
  for (const img of extraImages ?? []) {
    const list = extraImagesByPost.get(img.post_id) ?? []
    list.push(img.image_url)
    extraImagesByPost.set(img.post_id, list)
  }
```

- [ ] **Step 3: Populate `imageUrls` in the final row map**

In the `return rows.map((r) => ({ ... }))` at the end of `hydratePosts`, add `imageUrls` right after `imageUrl`:

```ts
    imageUrl: r.image_url,
    imageUrls: r.image_url ? [r.image_url, ...(extraImagesByPost.get(r.id) ?? [])] : (extraImagesByPost.get(r.id) ?? []),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails at this point — `components/community/PostCard.tsx` (unmodified until Task 7) doesn't yet read `imageUrls`, which is fine (it isn't required to); the failure to watch for is any other `PostView` literal missing the new field. Search for other object literals typed as `PostView` outside `feed-query.ts`:

```bash
grep -rln "PostView" --include=*.ts --include=*.tsx . | grep -v feed-query.ts | grep -v PostCard.tsx
```

Expected: no results other than places that only *consume* a `PostView` (not construct one) — `tsc --noEmit` confirms this either way.

- [ ] **Step 5: Commit**

```bash
git add lib/community/feed-query.ts
git commit -m "feat(community): hydratePosts reads community_post_images into PostView.imageUrls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 5: `PostComposer` — multi-file picker and upload

**Files:**
- Modify: `components/community/PostComposer.tsx` (whole file)

**Interfaces:**
- Consumes: `MAX_POST_IMAGES` from `lib/community/schema.ts` (Task 2), `createPost({ content, imageUrls })` from `lib/community/post-actions.ts` (Task 3).

No TDD here — a client component with browser-only file/canvas APIs, verified end-to-end in Task 9 (existing convention: no test file for this component today).

- [ ] **Step 1: Rewrite the composer**

Replace the full contents of `components/community/PostComposer.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus } from 'lucide-react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { createClient } from '@/lib/supabase/client'
import { createPost } from '@/lib/community/post-actions'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { MAX_POST_IMAGES } from '@/lib/community/schema'
import type { MembershipTier } from '@/lib/membership/tiers'

const MAX_CHARS = 500

export interface ViewerProfile {
  avatarUrl: string | null
  username: string | null
  displayName: string | null
  membershipTier: string
  frameUrl?: string
}

// Bottom sheet on mobile, modal on desktop (spec §6). Images are only
// uploaded on submit, not on selection — avoids orphaning storage objects
// for a post the player never actually publishes. Up to MAX_POST_IMAGES
// files; clampImageUrls (lib/community/schema.ts) re-enforces the cap
// server-side so this client cap is a UX nicety, not the real gate.
export function PostComposer({ viewer, onClose }: { viewer: ViewerProfile; onClose: () => void }) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const name = viewer.displayName ?? viewer.username ?? 'You'

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

  // Object URLs are only ever derived from `files` — recompute and revoke the
  // previous batch whenever the file list changes, so nothing leaks.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [files])

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_POST_IMAGES))
  }

  function removeImage(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const canPost = (content.trim().length > 0 || files.length > 0) && content.length <= MAX_CHARS

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canPost || pending) return
    setError(null)

    startTransition(async () => {
      const imageUrls: string[] = []
      if (files.length > 0) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          for (const file of files) {
            const resized = await resizeImageToMaxWidth(file, 800)
            const path = `${user.id}/${crypto.randomUUID()}.jpg`
            const { error: upErr } = await supabase.storage.from('community-images').upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
            if (upErr) throw upErr
            imageUrls.push(supabase.storage.from('community-images').getPublicUrl(path).data.publicUrl)
          }
        } catch {
          setError('An image failed to upload. Please try again.')
          return
        }
      }

      const res = await createPost({ content, imageUrls })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="New post" className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg sm:px-4">
        <form
          onSubmit={onSubmit}
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:rounded-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-black uppercase tracking-widest text-sx-white">New Post</p>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-sx-gray hover:text-sx-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex items-start gap-2.5">
            <HexAvatar src={viewer.avatarUrl} username={name} tier={viewer.membershipTier as MembershipTier} size="sm" frameUrl={viewer.frameUrl} />
            <div className="min-w-0 flex-1">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                maxLength={MAX_CHARS}
                placeholder="What's happening in the SentinelX community?"
                className="w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
                autoFocus
              />
              <p className="mt-1 text-right text-[11px] text-sx-gray">
                {content.length} / {MAX_CHARS}
              </p>
            </div>
          </div>

          {previews.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-20 w-20 rounded-lg border border-sx-border object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="Remove image"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-sx-gray hover:text-sx-purple-text">
              <ImagePlus className="h-4 w-4" />
              {files.length > 0 ? `Add Screenshot (${files.length}/${MAX_POST_IMAGES})` : 'Add Screenshot'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onPickFiles}
                className="hidden"
                disabled={files.length >= MAX_POST_IMAGES}
              />
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-sx-gray hover:text-sx-white">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canPost || pending}
                className="rounded-lg bg-sx-purple px-5 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
              >
                {pending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Manual verification**

On a local/preview build, logged in:
1. Open the composer, add one screenshot. Confirm a single 80×80 thumbnail with a remove (×) button appears.
2. Add up to 5 more screenshots in separate picks. Confirm the thumbnail strip grows, wraps on narrow widths, and the "Add Screenshot" control disables/hides once 5 are selected, showing `(5/5)`.
3. Remove one thumbnail. Confirm the count updates and the file input re-enables.
4. Submit a post with 3 images. Confirm it succeeds and the composer closes.

- [ ] **Step 4: Commit**

```bash
git add components/community/PostComposer.tsx
git commit -m "feat(community): PostComposer supports up to 5 images

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 6: `PostMediaCarousel` component

**Files:**
- Create: `components/community/PostMediaCarousel.tsx`

**Interfaces:**
- Consumes: `ImageLightbox` from `components/community/ImageLightbox.tsx` (already supports `urls: string[]`, `index`, `onIndexChange` — no change needed there).
- Produces: `PostMediaCarousel({ images: string[] })` — a React component, renders `null` for an empty array.
- Consumed by: `components/community/PostCard.tsx` (Task 7).

No TDD here — pure presentation/interaction, verified end-to-end in Task 9.

- [ ] **Step 1: Write the component**

Create `components/community/PostMediaCarousel.tsx`:

```tsx
'use client'
import { useRef, useState } from 'react'
import { ImageLightbox } from './ImageLightbox'

// Scroll-snap + dots, no carousel library (spec: "Out — ... the cuttable
// corner: the carousel" is about NOT building this; the addendum decided to
// build it anyway). Every slide is letterboxed (object-contain in a fixed
// aspect box), never cropped — the class of bug that hit the game cards from
// a fixed-height object-cover crop.
export function PostMediaCarousel({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (images.length === 0) return null

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setIndex(Math.min(images.length - 1, Math.max(0, i)))
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => {
              setIndex(i)
              setLightboxOpen(true)
            }}
            aria-label={`View image ${i + 1} of ${images.length}`}
            className="flex aspect-[4/3] w-full flex-none snap-center items-center justify-center bg-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-contain" />
          </button>
        ))}
      </div>

      {images.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2">
          {images.map((_, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-sx-purple' : 'bg-sx-gray/40'}`} />
          ))}
        </div>
      )}

      {lightboxOpen && (
        <ImageLightbox urls={images} index={index} onClose={() => setLightboxOpen(false)} onIndexChange={setIndex} />
      )}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add components/community/PostMediaCarousel.tsx
git commit -m "feat(community): PostMediaCarousel — scroll-snap + dots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

(Manual verification of the carousel happens as part of Task 7, once it's actually wired into a card.)

---

## Task 7: `PostCard` — media-first restructure

**Files:**
- Modify: `components/community/PostCard.tsx:1-123`

**Interfaces:**
- Consumes: `PostView.imageUrls` (Task 4), `PostMediaCarousel` (Task 6).

No TDD here — presentation change to an existing component, verified end-to-end in this task's own manual step and again in Task 9.

- [ ] **Step 1: Rewrite `ManualOrAchievementCard`**

In `components/community/PostCard.tsx`, replace the `ImageLightbox` import and the whole `ManualOrAchievementCard` function:

```ts
import { PostMediaCarousel } from './PostMediaCarousel'
```

(remove the now-unused `import { ImageLightbox } from './ImageLightbox'` — `PostMediaCarousel` owns the lightbox internally)

```tsx
function ManualOrAchievementCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isAchievement = post.postType === 'achievement'
  // Shared with the feed's ranking and canBoost, so the badge and the position
  // can never disagree again — they did for three weeks.
  const isBoosted = isBoostLive(post.boostedUntil, new Date())
  const name = post.author.displayName ?? post.author.username ?? 'Player'

  function onDelete() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await deletePost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  function onBoost() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await boostPost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className={`rounded-2xl border bg-sx-surface p-4 sm:p-5 ${isAchievement ? 'border-amber-500/30' : isBoosted ? 'border-amber-400/50' : 'border-sx-border'}`}>
      {isAchievement && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🏅 Achievement Unlocked</p>}
      {isBoosted && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🚀 Boosted</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <HexAvatar src={post.author.avatarUrl} username={name} tier={post.author.membershipTier as MembershipTier} size="xs" frameUrl={post.author.frameUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sx-white">
              {post.author.username ? (
                <Link href={`/players/${post.author.username}`} className="hover:text-sx-purple-text">
                  {name}
                </Link>
              ) : (
                name
              )}
            </p>
            <div className="flex items-center gap-1.5">
              <TierBadge tier={post.author.sentinelTier} />
              <span className="text-[11px] text-sx-gray">· {formatRelativeTime(post.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {post.canBoost && (
            <button type="button" onClick={onBoost} disabled={pending} className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50">
              🚀 Boost (200 coins)
            </button>
          )}
          {post.canDelete && (
            <button type="button" onClick={onDelete} disabled={pending} className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Media-first: image(s) bleed to the card's full width, no padding or
          rounding on the media itself — achieved with a negative margin that
          matches the card's own padding, so text-only posts (no images
          rendered at all) keep today's layout completely unchanged. */}
      {post.imageUrls.length > 0 && (
        <div className="-mx-4 mt-3 sm:-mx-5">
          <PostMediaCarousel images={post.imageUrls} />
        </div>
      )}

      <p className="mt-3 whitespace-pre-line text-sm text-sx-white/90">{post.content}</p>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <ReactionBar postId={post.id} counts={post.reactionCounts} myReaction={post.myReaction} loggedIn={loggedIn} />
        <div className="flex items-center gap-3">
          <Link href={`/community/${post.id}`} className="text-xs font-semibold text-sx-gray hover:text-sx-white">
            💬 {post.commentCount}
          </Link>
          {loggedIn && <MutePostButton postId={post.id} muted={post.mutedByViewer} />}
          <ShareButton post={post} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Manual verification**

On a local/preview build:
1. A text-only post: confirm its layout is pixel-identical to before this plan (no image block rendered, no extra gap).
2. A single-image post (from an existing pre-migration post, whose `imageUrls` falls back to `[imageUrl]`): confirm it renders full-bleed, letterboxed (not cropped) if the image is a tall/portrait shot, and tapping it opens the lightbox on that one image.
3. A new multi-image post (3-5 images, created in Task 5's verification): confirm horizontal swipe/scroll works, dots track the active slide, and tapping any slide opens the lightbox starting at that image with working prev/next arrows.
4. At 360px width and at desktop width: confirm no horizontal overflow of the page itself (only the carousel's own internal scroller scrolls).
5. A `match_result` post and an `announcement` post: confirm both are visually unchanged (this task never touches `MatchResultCard`/`AnnouncementCard`).

- [ ] **Step 4: Commit**

```bash
git add components/community/PostCard.tsx
git commit -m "feat(community): PostCard media-first restructure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 8: Profile image grid

**Files:**
- Create: `components/player/ProfileImageGrid.tsx`
- Modify: `app/[locale]/(public)/players/[username]/page.tsx` (the `Promise.all` fetch block, near `profilePosts`, and render next to `ProfileCommunityPosts`)

**Interfaces:**
- Produces: `ProfileImageGrid({ items: { id: string; imageUrl: string }[] })`.

No TDD here — a server-component data fetch + presentational grid, verified end-to-end in this task's own manual step.

**Execution note:** this plan's original line numbers for the profile page assumed the file as it stood when the plan was written. Piece 3 (Follows) has since merged to `main` and added `fetchIsFollowing`/`fetchFollowCounts` calls and a `followCounts` entry as the *last* item in the same `Promise.all` this task also extends. Insert this task's new query entry immediately after the existing `rawProfilePosts` entry and *before* `followCounts` (not at the end of the array) — the position relative to `rawProfilePosts` is what matters, not an absolute line number.

- [ ] **Step 1: Write the grid component**

Create `components/player/ProfileImageGrid.tsx`:

```tsx
import Link from 'next/link'

export interface ProfileImageGridItem {
  id: string
  imageUrl: string
}

// The single most recognisably "Instagram" element of the media-first feed
// (spec) — cropping to square here is fine, that's what a grid is for
// (unlike the feed card, which must letterbox).
export function ProfileImageGrid({ items }: { items: ProfileImageGridItem[] }) {
  if (items.length === 0) return null
  return (
    <section id="gallery" className="scroll-mt-24">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-white">Gallery</h2>
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl">
        {items.map((item) => (
          <Link key={item.id} href={`/community/${item.id}`} className="aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          </Link>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add the query**

In `app/[locale]/(public)/players/[username]/page.tsx`, add the import and one entry to the existing `Promise.all` destructure + array. Add to the import block:

```ts
import { ProfileImageGrid } from '@/components/player/ProfileImageGrid'
```

Add `{ data: rawGalleryPosts }` to the destructured array, immediately after `{ data: rawProfilePosts }` and before whatever entry (if any) follows it:

```ts
    { data: rawProfilePosts },
    { data: rawGalleryPosts },
```

and the matching query, immediately after the `rawProfilePosts` query and before whatever query (if any) follows it in the array:

```ts
    supabase
      .from('community_posts')
      .select('id, image_url')
      .eq('author_id', p.id)
      .eq('is_deleted', false)
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(18),
```

- [ ] **Step 3: Map the rows**

Add near the existing `profilePosts` mapping:

```ts
  const galleryItems = (
    (rawGalleryPosts ?? []) as { id: string; image_url: string | null }[]
  )
    .filter((r): r is { id: string; image_url: string } => r.image_url != null)
    .map((r) => ({ id: r.id, imageUrl: r.image_url }))
```

- [ ] **Step 4: Render it**

Place `<ProfileImageGrid items={galleryItems} />` next to `<ProfileCommunityPosts>`:

```tsx
          <ProfileCommunityPosts posts={profilePosts} username={params.username} />
          <ProfileImageGrid items={galleryItems} />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 6: Manual verification**

On a local/preview build:
1. Visit the profile of a player with several image posts (including some multi-image ones from Task 5's verification). Confirm a 3-column square grid appears near "Community Posts", showing only the first image of each post, newest first, capped at 18.
2. Tap a grid tile. Confirm it navigates to `/community/{id}` (the post detail page) for the right post.
3. Visit the profile of a player with zero image posts. Confirm the "Gallery" section does not render at all (no empty-state clutter).
4. At 360px width: confirm the grid is exactly 3 columns with no horizontal overflow.

- [ ] **Step 7: Commit**

```bash
git add components/player/ProfileImageGrid.tsx "app/[locale]/(public)/players/[username]/page.tsx"
git commit -m "feat(players): profile image gallery grid

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQuHvmoqrCXoQSSpRptiBi"
```

---

## Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all green, including the new `lib/community/schema.test.ts`.

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit
npx next lint
```

Expected: both clean.

- [ ] **Step 3: Manual E2E — full post lifecycle**

On a local/preview build, logged in:
1. Create a post with 5 images. Confirm it appears at the top of `/community`, media-first, carousel with 5 dots, swiping works, letterboxed (not cropped).
2. Open the post's detail page (`/community/{id}`). Confirm the same carousel renders there too (proves `hydratePosts` is genuinely shared, not duplicated).
3. Visit the author's profile. Confirm the new post's first image appears at the top of the Gallery grid.
4. Delete the post (as its author). Confirm it disappears from the feed, the detail page 404s or shows removed, and the gallery grid no longer shows it.

- [ ] **Step 4: Manual E2E — legacy single-image posts still work**

1. Find (or use QA test data for) a post created before this plan, with exactly one image.
2. Confirm it still renders correctly in the feed (via the `imageUrl` → `[imageUrl]` fallback in `hydratePosts`), in the profile gallery, and in `CommunityGallery` on `/community` (untouched by this plan, still reads `image_url` directly).

- [ ] **Step 5: Manual E2E — layout regression check**

At 360px width and desktop width, click through `/community` (scroll past several posts of each type), a post detail page, and a player profile with a full gallery. Confirm no horizontal page overflow anywhere — the specific failure mode this codebase has hit repeatedly (spec "Testing").

- [ ] **Step 6: Report results**

Summarize the manual E2E outcomes (pass/fail per step) before considering this plan done. Any step that fails goes back through `superpowers:systematic-debugging`, not a quick patch.
