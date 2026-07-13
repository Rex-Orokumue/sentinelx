# Community Pillar (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 🤝 Community pillar — a public, per-game discussion feed with
one-level replies and optional post images, replacing its current
`/coming-soon?feature=Community` placeholder.

**Architecture:** New `community_posts`/`community_replies` tables (public read,
own-write, author-or-staff delete via RLS — no service-role client needed anywhere
in this feature, unlike the payment/escrow flows). A new public Storage bucket
`community-images` mirrors the existing `listing-images` bucket exactly. Server
Components fetch posts with replies eagerly nested (no client-side reply fetching);
client components handle the post/reply composers, expand/collapse, and delete
forms. Admin gets a lightweight moderation list, no approval queue.

**Tech Stack:** Next.js 14 (App Router, Server Actions), TypeScript, Supabase
(Postgres + RLS + Storage), Tailwind CSS, Zod, Vitest.

## Global Constraints

- Mobile-first — design for 375px width, scale up (CLAUDE.md).
- Use Supabase Row Level Security (RLS) on every table.
- Admin routes must never be reachable by non-staff users — `/admin/community` calls
  `requireStaff()`, matching every existing admin page.
- No approval queue for posts/images — live immediately, staff removes after
  (explicit design decision, not an oversight).
- No edit support — delete-and-repost only, for both posts and replies.
- No nested replies — one level only, replies attach to the post.
- No video attachments — text + optional single image only, per the platform's
  no-native-video-hosting rule.
- `body` is capped at 2000 characters, enforced by both a DB `CHECK` constraint
  (the backstop) and Zod validation (the actual friendly error path) — never rely
  on only one layer.
- Orphaned images in `community-images` on post delete, and no image
  pre-moderation, are both accepted, documented gaps for v1 — not to be "fixed"
  as part of this plan.
- Follow existing patterns exactly: Zod schemas mirror `lib/exchange/schema.ts`,
  image upload mirrors `components/exchange/ListingForm.tsx`, admin search reuses
  `lib/admin/search.ts` + `components/admin/PlayerSearch.tsx`, delete forms mirror
  `lib/exchange/actions.ts`'s `removeListing`.

---

## File Structure

**New files:**
- `supabase/migrations/016_community.sql` — schema, RLS, storage bucket.
- `lib/community/schema.ts` + `.test.ts` — Zod validation for posts/replies.
- `lib/community/actions.ts` — `createPost`, `createReply`, `deletePost`, `deleteReply`.
- `components/community/PostComposer.tsx` — client, text + optional image upload.
- `components/community/ReplyComposer.tsx` — client, text-only reply form.
- `components/community/PostCard.tsx` — post display, expand/collapse replies,
  delete forms; exports `PostView`/`ReplyView`.
- `app/(public)/community/page.tsx` — the public feed page.
- `components/admin/AdminCommunityPostRow.tsx` — one admin post row + Remove button.
- `components/admin/AdminCommunityList.tsx` — client search wrapper (reuses
  `PlayerSearch`/`matchesPlayerQuery`).
- `app/admin/community/page.tsx` — admin moderation list.

**Modified files:**
- `lib/supabase/types.ts` — add `community_posts`/`community_replies` Row/Insert/Update.
- `lib/nav/tabs.ts` — `community` pillar entry points at `/community` instead of
  `/coming-soon?feature=Community`.
- `lib/admin/nav.ts` — add a `Community` entry to `ADMIN_NAV`.
- `components/shared/SiteHeader.tsx` — add `Community` to the desktop `NAV` array
  (confirmed absent today — its visible "Community" button is the unrelated
  external WhatsApp CTA and must not be touched).

---

### Task 1: Migration + Supabase types

**Files:**
- Create: `supabase/migrations/016_community.sql`
- Modify: `lib/supabase/types.ts` (append `community_posts`/`community_replies` table blocks, alphabetically among the existing tables)

**Interfaces:**
- Produces: DB tables `community_posts`, `community_replies`, storage bucket
  `community-images`, reflected in `Database['public']['Tables']`. Consumed by
  every later task.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/016_community.sql`:

```sql
-- =============================================================
-- Community pillar (v1) — per-game posts + one-level replies
-- =============================================================

CREATE TABLE public.community_posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    uuid        NOT NULL REFERENCES public.games(id),
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_replies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_posts (game_id);
CREATE INDEX ON public.community_posts (created_at DESC);
CREATE INDEX ON public.community_replies (post_id);

CREATE TRIGGER set_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.community_posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_replies ENABLE ROW LEVEL SECURITY;

-- Public read, matching /tournaments and /exchange — logged-out visitors browse.
CREATE POLICY "community_posts_public_read"   ON public.community_posts   FOR SELECT USING (true);
CREATE POLICY "community_replies_public_read" ON public.community_replies FOR SELECT USING (true);

-- Any authenticated player can post/reply as themselves.
CREATE POLICY "community_posts_own_insert"   ON public.community_posts   FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "community_replies_own_insert" ON public.community_replies FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Author deletes their own; staff (admin + moderator) deletes anything.
CREATE POLICY "community_posts_delete"   ON public.community_posts   FOR DELETE USING (auth.uid() = author_id OR is_staff());
CREATE POLICY "community_replies_delete" ON public.community_replies FOR DELETE USING (auth.uid() = author_id OR is_staff());

-- Public bucket for post images (readers browse them; public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('community-images', 'community-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "community_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'community-images');
CREATE POLICY "community_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "community_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'community-images' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff()));
```

- [ ] **Step 2: Apply the migration**

Run `supabase db push` (do a `--dry-run` first and confirm it lists only
`016_community.sql` before applying for real — migration history is fully
reconciled through 015 as of this plan, so this should be a clean single-step
push with no repair needed, unlike migration 015's history mismatch).

- [ ] **Step 3: Update generated types**

Add to `lib/supabase/types.ts`, alongside the other table blocks (insert
alphabetically — `community_posts`/`community_replies` sort near the top,
before `exchange`-prefixed and `games` tables):

```ts
      community_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          game_id: string
          id: string
          image_url: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          game_id: string
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          game_id?: string
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      community_replies: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_community.sql lib/supabase/types.ts
git commit -m "feat: community pillar — posts/replies schema, RLS, image bucket"
```

---

### Task 2: Validation schema

**Files:**
- Create: `lib/community/schema.ts`
- Test: `lib/community/schema.test.ts`

**Interfaces:**
- Produces: `communityPostSchema` (fields: `gameId`, `body`, `imageUrl`),
  `communityReplySchema` (fields: `postId`, `body`), `type CommunityPostInput`,
  `type CommunityReplyInput`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `lib/community/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { communityPostSchema, communityReplySchema } from './schema'

const validPost = {
  gameId: '11111111-1111-4111-8111-111111111111',
  body: 'Anyone up for a friendly before the weekend cup?',
  imageUrl: '',
}
const validReply = {
  postId: '22222222-2222-4222-8222-222222222222',
  body: "I'm in!",
}

describe('communityPostSchema', () => {
  it('accepts a valid post with no image', () => {
    expect(communityPostSchema.safeParse(validPost).success).toBe(true)
  })
  it('accepts a valid post with an image URL', () => {
    expect(
      communityPostSchema.safeParse({ ...validPost, imageUrl: 'https://x.supabase.co/img.jpg' }).success,
    ).toBe(true)
  })
  it('rejects an empty body', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: '   ' }).success).toBe(false)
  })
  it('rejects a body over 2000 characters', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: 'x'.repeat(2001) }).success).toBe(false)
  })
  it('accepts a body at exactly 2000 characters', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: 'x'.repeat(2000) }).success).toBe(true)
  })
  it('rejects a non-uuid gameId', () => {
    expect(communityPostSchema.safeParse({ ...validPost, gameId: 'dls' }).success).toBe(false)
  })
  it('rejects a malformed image URL', () => {
    expect(communityPostSchema.safeParse({ ...validPost, imageUrl: 'not a url' }).success).toBe(false)
  })
})

describe('communityReplySchema', () => {
  it('accepts a valid reply', () => {
    expect(communityReplySchema.safeParse(validReply).success).toBe(true)
  })
  it('rejects an empty body', () => {
    expect(communityReplySchema.safeParse({ ...validReply, body: '' }).success).toBe(false)
  })
  it('rejects a body over 2000 characters', () => {
    expect(communityReplySchema.safeParse({ ...validReply, body: 'x'.repeat(2001) }).success).toBe(false)
  })
  it('rejects a non-uuid postId', () => {
    expect(communityReplySchema.safeParse({ ...validReply, postId: 'not-a-uuid' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/community/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write the implementation**

Create `lib/community/schema.ts`:

```ts
import { z } from 'zod'

const body2000 = z.string().trim().min(1, 'Write something first').max(2000, 'Keep it under 2000 characters')

export const communityPostSchema = z.object({
  gameId: z.string().uuid('Choose a game'),
  body: body2000,
  imageUrl: z.union([z.literal(''), z.string().trim().url('Invalid image URL')]).optional(),
})
export type CommunityPostInput = z.infer<typeof communityPostSchema>

export const communityReplySchema = z.object({
  postId: z.string().uuid('Missing post'),
  body: body2000,
})
export type CommunityReplyInput = z.infer<typeof communityReplySchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/community/schema.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/community/schema.ts lib/community/schema.test.ts
git commit -m "feat: community post/reply validation schema"
```

---

### Task 3: Server Actions

**Files:**
- Create: `lib/community/actions.ts`

**Interfaces:**
- Consumes: `communityPostSchema`, `communityReplySchema` (Task 2).
- Produces: `createPost(input: { gameId: string; body: string; imageUrl?: string }): Promise<{ id?: string; error?: string }>`,
  `createReply(_prev: ReplyState, formData: FormData): Promise<ReplyState>`,
  `deletePost(_prev: DeleteState, formData: FormData): Promise<DeleteState>`,
  `deleteReply(_prev: DeleteState, formData: FormData): Promise<DeleteState>`,
  `type ReplyState = { error?: string; success?: boolean } | undefined`,
  `type DeleteState = { error?: string } | undefined`. Consumed by Tasks 4, 5, 6, 9.

No new pure logic here — validation is already tested in Task 2. This task wires
it into Server Actions, verified by build + the manual pass in Task 10, matching
how every other Server Action task in this codebase's history has been verified
(e.g. `registerForTournament`, `createListing`).

All writes go through the plain session client — RLS's `own_insert`/`delete`
policies (`auth.uid() = author_id OR is_staff()`) are sufficient on their own;
this feature needs no service-role/admin client anywhere.

- [ ] **Step 1: Write the file**

Create `lib/community/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { communityPostSchema, communityReplySchema } from './schema'

export type ReplyState = { error?: string; success?: boolean } | undefined
export type DeleteState = { error?: string } | undefined

// Called from the client composer with an already-uploaded image URL (if any).
export async function createPost(input: {
  gameId: string
  body: string
  imageUrl?: string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const parsed = communityPostSchema.safeParse({
    gameId: input.gameId,
    body: input.body,
    imageUrl: input.imageUrl ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      game_id: d.gameId,
      author_id: user.id,
      body: d.body,
      image_url: d.imageUrl || null,
    })
    .select('id')
    .single()
  if (error || !post) return { error: 'Could not post. Please try again.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { id: post.id }
}

export async function createReply(_prev: ReplyState, formData: FormData): Promise<ReplyState> {
  const parsed = communityReplySchema.safeParse({
    postId: formData.get('postId'),
    body: formData.get('body'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to reply.' }

  const { error } = await supabase.from('community_replies').insert({
    post_id: parsed.data.postId,
    author_id: user.id,
    body: parsed.data.body,
  })
  if (error) return { error: 'Could not post your reply. Please try again.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { success: true }
}

export async function deletePost(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing post.' }
  const supabase = createClient()
  // RLS permits the author or staff to delete; anyone else's DELETE affects 0 rows.
  const { error } = await supabase.from('community_posts').delete().eq('id', id)
  if (error) return { error: 'Could not delete this post.' }
  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

export async function deleteReply(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing reply.' }
  const supabase = createClient()
  const { error } = await supabase.from('community_replies').delete().eq('id', id)
  if (error) return { error: 'Could not delete this reply.' }
  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: PASS — no existing tests touch this file; confirms nothing broke.

- [ ] **Step 3: Commit**

```bash
git add lib/community/actions.ts
git commit -m "feat: community post/reply/delete server actions"
```

---

### Task 4: Post composer (text + optional image upload)

**Files:**
- Create: `components/community/PostComposer.tsx`

**Interfaces:**
- Consumes: `createPost` (Task 3), `createClient` from `@/lib/supabase/client`
  (existing browser client, used identically in `components/exchange/ListingForm.tsx`).
- Produces: `PostComposer({ gameId }: { gameId: string })` — consumed by Task 6.

- [ ] **Step 1: Write the file**

Create `components/community/PostComposer.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPost } from '@/lib/community/actions'

export function PostComposer({ gameId }: { gameId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setError('Please log in.')
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('community-images')
      .upload(path, file, { upsert: false })
    if (upErr) {
      setError('Image failed to upload. Please try again.')
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('community-images').getPublicUrl(path)
    setImageUrl(data.publicUrl)
    setUploading(false)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError('Write something first')
      return
    }
    startTransition(async () => {
      const res = await createPost({ gameId, body, imageUrl: imageUrl ?? undefined })
      if (res.error) {
        setError(res.error)
        return
      }
      setBody('')
      setImageUrl(null)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Share something with the community…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {imageUrl && (
        <div className="relative mt-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => setImageUrl(null)}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-xs text-white"
            aria-label="Remove image"
          >
            ✕
          </button>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="cursor-pointer text-xs font-bold text-violet-400 hover:text-violet-300">
          {uploading ? 'Uploading…' : imageUrl ? 'Change image' : '+ Add image'}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" disabled={uploading} />
        </label>
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-lg bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: build will fail at this point only if there's a syntax error — `PostComposer`
isn't imported anywhere yet (Task 6 wires it in), so this step just confirms the
file itself compiles cleanly in isolation via the full Next.js type-check.

- [ ] **Step 3: Commit**

```bash
git add components/community/PostComposer.tsx
git commit -m "feat: community post composer (text + optional image upload)"
```

---

### Task 5: Reply composer + PostCard (display, expand/collapse, delete)

**Files:**
- Create: `components/community/ReplyComposer.tsx`
- Create: `components/community/PostCard.tsx`

**Interfaces:**
- Consumes: `createReply`, `deletePost`, `deleteReply`, `ReplyState`, `DeleteState`
  (Task 3), `Avatar` (existing, `components/shared/Avatar.tsx`), `formatDateTime`
  (existing, `lib/format.ts`).
- Produces: `ReplyComposer({ postId }: { postId: string })`,
  `PostCard({ post, canReply }: { post: PostView; canReply: boolean })`,
  `type PostView`, `type ReplyView` — consumed by Task 6.

- [ ] **Step 1: Write `ReplyComposer.tsx`**

Create `components/community/ReplyComposer.tsx`:

```tsx
'use client'
import { useEffect, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createReply, type ReplyState } from '@/lib/community/actions'

export function ReplyComposer({ postId }: { postId: string }) {
  const [state, formAction] = useFormState<ReplyState, FormData>(createReply, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.success) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="mt-3 flex gap-2">
      <input type="hidden" name="postId" value={postId} />
      <textarea
        name="body"
        rows={1}
        required
        maxLength={2000}
        placeholder="Write a reply…"
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <SubmitButton />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? '…' : 'Reply'}
    </button>
  )
}
```

- [ ] **Step 2: Write `PostCard.tsx`**

Create `components/community/PostCard.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { Avatar } from '@/components/shared/Avatar'
import { formatDateTime } from '@/lib/format'
import { deletePost, deleteReply, type DeleteState } from '@/lib/community/actions'
import { ReplyComposer } from './ReplyComposer'

export interface ReplyView {
  id: string
  body: string
  createdAt: string
  authorUsername: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  canDelete: boolean
}

export interface PostView {
  id: string
  body: string
  imageUrl: string | null
  createdAt: string
  authorUsername: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  canDelete: boolean
  replies: ReplyView[]
}

export function PostCard({ post, canReply }: { post: PostView; canReply: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [delState, delAction] = useFormState<DeleteState, FormData>(deletePost, undefined)
  const authorName = post.authorDisplayName ?? post.authorUsername ?? 'Player'

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar
            avatarUrl={post.authorAvatarUrl}
            displayName={post.authorDisplayName}
            username={post.authorUsername}
            size={32}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{authorName}</p>
            <p className="text-[11px] text-slate-500">{formatDateTime(post.createdAt)}</p>
          </div>
        </div>
        {post.canDelete && (
          <form action={delAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
              Delete
            </button>
          </form>
        )}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-slate-200">{post.body}</p>
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrl} alt="" className="mt-3 max-h-96 w-full rounded-xl object-cover" />
      )}
      {delState?.error && <p className="mt-2 text-xs text-red-400">{delState.error}</p>}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-bold text-violet-400 hover:text-violet-300"
      >
        {post.replies.length === 0
          ? 'Reply'
          : `${expanded ? 'Hide' : 'Show'} ${post.replies.length} repl${post.replies.length === 1 ? 'y' : 'ies'}`}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-l-2 border-slate-800 pl-4">
          {post.replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </div>
      )}
      {(expanded || post.replies.length === 0) && canReply && <ReplyComposer postId={post.id} />}
    </div>
  )
}

function ReplyRow({ reply }: { reply: ReplyView }) {
  const [delState, delAction] = useFormState<DeleteState, FormData>(deleteReply, undefined)
  const name = reply.authorDisplayName ?? reply.authorUsername ?? 'Player'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Avatar
          avatarUrl={reply.authorAvatarUrl}
          displayName={reply.authorDisplayName}
          username={reply.authorUsername}
          size={22}
        />
        <div className="min-w-0">
          <p className="text-xs font-bold text-white">
            {name} <span className="font-normal text-slate-500">· {formatDateTime(reply.createdAt)}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-slate-300">{reply.body}</p>
          {delState?.error && <p className="mt-1 text-[11px] text-red-400">{delState.error}</p>}
        </div>
      </div>
      {reply.canDelete && (
        <form action={delAction}>
          <input type="hidden" name="id" value={reply.id} />
          <button type="submit" className="shrink-0 text-[11px] font-semibold text-red-400 hover:text-red-300">
            Delete
          </button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed (neither component is wired into a page yet — Task 6 does
that — this confirms both compile and type-check cleanly).

- [ ] **Step 4: Commit**

```bash
git add components/community/ReplyComposer.tsx components/community/PostCard.tsx
git commit -m "feat: community PostCard (expand/collapse replies, delete) + ReplyComposer"
```

---

### Task 6: Public `/community` feed page

**Files:**
- Create: `app/(public)/community/page.tsx`

**Interfaces:**
- Consumes: `PostComposer` (Task 4), `PostCard`, `type PostView` (Task 5),
  `getStaffContext` (existing, `lib/admin/auth.ts`).
- Produces: the `/community` route. Consumed by Task 8 (nav wiring) and Task 10
  (manual verification).

- [ ] **Step 1: Write the page**

Create `app/(public)/community/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'
import { PostComposer } from '@/components/community/PostComposer'
import { PostCard, type PostView } from '@/components/community/PostCard'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
const PAGE_SIZE = 30

export const metadata: Metadata = {
  title: 'Community — Sentinel X',
  description: "Discuss, share, and connect with Nigeria's mobile esports community on Sentinel X.",
  openGraph: {
    title: 'Community — Sentinel X',
    description: "Discuss, share, and connect with Nigeria's mobile esports community.",
    url: `${SITE_URL}/community`,
    siteName: 'Sentinel X',
    type: 'website',
  },
}

type ProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function firstProfile(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: { game?: string; before?: string }
}) {
  const supabase = createClient()
  const [{ data: games }, {
    data: { user },
  }, staff] = await Promise.all([
    supabase.from('games').select('id, name, slug, icon_url').eq('active', true).order('name'),
    supabase.auth.getUser(),
    getStaffContext(),
  ])

  const gameList = games ?? []
  const activeSlug = searchParams.game ?? gameList[0]?.slug ?? null
  const activeGame = gameList.find((g) => g.slug === activeSlug) ?? null

  let posts: PostView[] = []
  let hasMore = false
  if (activeGame) {
    let query = supabase
      .from('community_posts')
      .select(
        'id, body, image_url, created_at, author_id, ' +
          'author:profiles!community_posts_author_id_fkey(username, display_name, avatar_url), ' +
          'community_replies(id, body, created_at, author_id, ' +
          'author:profiles!community_replies_author_id_fkey(username, display_name, avatar_url))',
      )
      .eq('game_id', activeGame.id)
      .order('created_at', { ascending: false })
      .order('created_at', { ascending: true, foreignTable: 'community_replies' })
      .limit(PAGE_SIZE)
    if (searchParams.before) query = query.lt('created_at', searchParams.before)
    const { data } = await query

    const rows = (data as unknown[] | null) ?? []
    hasMore = rows.length === PAGE_SIZE
    posts = rows.map((raw) => {
      const p = raw as {
        id: string
        body: string
        image_url: string | null
        created_at: string
        author_id: string
        author: ProfileRef
        community_replies: {
          id: string
          body: string
          created_at: string
          author_id: string
          author: ProfileRef
        }[]
      }
      const author = firstProfile(p.author)
      return {
        id: p.id,
        body: p.body,
        imageUrl: p.image_url,
        createdAt: p.created_at,
        authorUsername: author?.username ?? null,
        authorDisplayName: author?.display_name ?? null,
        authorAvatarUrl: author?.avatar_url ?? null,
        canDelete: !!user && (user.id === p.author_id || staff.isStaff),
        replies: p.community_replies.map((r) => {
          const rAuthor = firstProfile(r.author)
          return {
            id: r.id,
            body: r.body,
            createdAt: r.created_at,
            authorUsername: rAuthor?.username ?? null,
            authorDisplayName: rAuthor?.display_name ?? null,
            authorAvatarUrl: rAuthor?.avatar_url ?? null,
            canDelete: !!user && (user.id === r.author_id || staff.isStaff),
          }
        }),
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Community</h1>
        <p className="mt-1 text-sm text-slate-400">
          Talk tactics, share highlights, and connect with other players.
        </p>
      </div>

      {gameList.length === 0 || !activeGame ? (
        <EmptyState icon="🤝" title="No games yet" body="Community boards will appear once a game is set up." />
      ) : (
        <>
          {gameList.length > 1 && <GameFilter games={gameList} active={activeGame.slug} />}

          {user ? (
            <PostComposer gameId={activeGame.id} />
          ) : (
            <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
              <Link href="/login?next=/community" className="text-sm font-bold text-violet-400 hover:text-violet-300">
                Log in to post →
              </Link>
            </div>
          )}

          {posts.length === 0 ? (
            <EmptyState icon="💬" title="No posts yet" body="Be the first to say something." />
          ) : (
            <div className="space-y-3">
              {posts.map((p) => (
                <PostCard key={p.id} post={p} canReply={!!user} />
              ))}
            </div>
          )}

          {hasMore && posts.length > 0 && (
            <div className="mt-4 text-center">
              <Link
                href={`/community?game=${activeGame.slug}&before=${encodeURIComponent(posts[posts.length - 1].createdAt)}`}
                className="text-sm text-violet-400 hover:text-violet-300"
              >
                Load more →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GameFilter({ games, active }: { games: { name: string; slug: string }[]; active: string }) {
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {games.map((g) => (
        <Link
          key={g.slug}
          href={`/community?game=${g.slug}`}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            active === g.slug
              ? 'border-violet-500/40 bg-violet-500/20 text-violet-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600'
          }`}
        >
          {g.name}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed; `/community` should now appear in the build's route list.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/community/page.tsx"
git commit -m "feat: public /community feed page"
```

---

### Task 7: Admin moderation list

**Files:**
- Create: `components/admin/AdminCommunityPostRow.tsx`
- Create: `components/admin/AdminCommunityList.tsx`
- Create: `app/admin/community/page.tsx`

**Interfaces:**
- Consumes: `deletePost` (Task 3), `matchesPlayerQuery` (existing,
  `lib/admin/search.ts`), `PlayerSearch` (existing, `components/admin/PlayerSearch.tsx`),
  `formatDateTime` (existing, `lib/format.ts`), `requireStaff` (existing,
  `lib/admin/auth.ts`).
- Produces: the `/admin/community` route, `AdminCommunityPost` type.

- [ ] **Step 1: Write `AdminCommunityPostRow.tsx`**

Create `components/admin/AdminCommunityPostRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { deletePost, type DeleteState } from '@/lib/community/actions'
import { formatDateTime } from '@/lib/format'

export interface AdminCommunityPost {
  id: string
  body: string
  imageUrl: string | null
  gameName: string
  authorUsername: string | null
  replyCount: number
  createdAt: string
}

export function AdminCommunityPostRow({ post }: { post: AdminCommunityPost }) {
  const [state, action] = useFormState<DeleteState, FormData>(deletePost, undefined)
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        {post.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-200">{post.body}</p>
          <p className="mt-1 text-xs text-slate-500">
            @{post.authorUsername ?? 'unknown'} · {post.gameName} · {post.replyCount} repl
            {post.replyCount === 1 ? 'y' : 'ies'} · {formatDateTime(post.createdAt)}
          </p>
          {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
        </div>
      </div>
      <form action={action}>
        <input type="hidden" name="id" value={post.id} />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Remove
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Write `AdminCommunityList.tsx`**

Create `components/admin/AdminCommunityList.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { AdminCommunityPostRow, type AdminCommunityPost } from './AdminCommunityPostRow'

export function AdminCommunityList({ posts }: { posts: AdminCommunityPost[] }) {
  const [query, setQuery] = useState('')
  const filtered = posts.filter((p) =>
    matchesPlayerQuery({ username: p.authorUsername, displayName: null }, query),
  )
  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} placeholder="Search by author username…" />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No posts match &quot;{query}&quot;.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <AdminCommunityPostRow key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Write the admin page**

Create `app/admin/community/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { AdminCommunityList, type AdminCommunityPost } from '@/components/admin/AdminCommunityList'

export const metadata: Metadata = { title: 'Community · Admin · SentinelX' }

type ProfileRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: ProfileRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}
type GameRef = { name: string } | { name: string }[] | null
function firstGameName(g: GameRef): string {
  return (Array.isArray(g) ? g[0]?.name : g?.name) ?? 'Unknown game'
}

export default async function AdminCommunityPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('community_posts')
    .select(
      'id, body, image_url, created_at, ' +
        'author:profiles!community_posts_author_id_fkey(username), ' +
        'games(name), ' +
        'community_replies(count)',
    )
    .order('created_at', { ascending: false })
    .limit(50)

  const posts: AdminCommunityPost[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const p = raw as {
      id: string
      body: string
      image_url: string | null
      created_at: string
      author: ProfileRef
      games: GameRef
      community_replies: { count: number }[]
    }
    return {
      id: p.id,
      body: p.body,
      imageUrl: p.image_url,
      gameName: firstGameName(p.games),
      authorUsername: firstUsername(p.author),
      replyCount: p.community_replies?.[0]?.count ?? 0,
      createdAt: p.created_at,
    }
  })

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Community — recent posts</h2>
      {posts.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No posts yet.
        </p>
      ) : (
        <AdminCommunityList posts={posts} />
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed; `/admin/community` should appear in the build's route list.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminCommunityPostRow.tsx components/admin/AdminCommunityList.tsx "app/admin/community/page.tsx"
git commit -m "feat: admin community moderation list (search + remove)"
```

---

### Task 8: Nav wiring

**Files:**
- Modify: `lib/nav/tabs.ts`
- Modify: `lib/admin/nav.ts`
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:** none new — this wires already-built pages into existing nav
structures (`PILLAR_TABS`, `ADMIN_NAV`, `SiteHeader`'s `NAV`).

- [ ] **Step 1: Update the mobile pillar tab**

In `lib/nav/tabs.ts`, replace the `community` entry in `PILLAR_TABS`:

```ts
  { key: 'community', label: 'Community', href: '/community', feature: null, match: '/community' },
```

(was: `href: '/coming-soon?feature=Community', feature: 'Community', match: null`)

- [ ] **Step 2: Add the admin nav entry**

In `lib/admin/nav.ts`, add a `Community` entry to `ADMIN_NAV` (after `Results`,
before `TV`, alphabetically-ish matching the existing loose ordering):

```ts
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
]
```

`adminOnly: false` — moderators can moderate community content (not a financial
action), matching Results/Tournaments/TV/Exchange.

- [ ] **Step 3: Add Community to the desktop header**

In `components/shared/SiteHeader.tsx`, add a `Community` entry to the `NAV` array
(confirmed absent today — do not touch the WhatsApp CTA button elsewhere in this
file, which is visually labeled "Community" but is a different, unrelated feature):

```ts
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/tv', label: 'TV' },
  { href: '/community', label: 'Community' },
  { href: '/exchange', label: 'Exchange' },
  { href: '/rankings', label: 'Rankings' },
]
```

- [ ] **Step 4: Run the test suite and build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/tabs.ts lib/admin/nav.ts components/shared/SiteHeader.tsx
git commit -m "feat: wire Community pillar into mobile tabs, desktop nav, admin nav"
```

---

### Task 9: Full verification + ROADMAP update

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:** none — integration checkpoint.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — every test file, including the new `lib/community/schema.test.ts`.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: succeeds with no TypeScript/Next.js errors; `/community` and
`/admin/community` both appear in the route list.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual walkthrough**

Using a local dev server (`npm run dev`) against a Supabase project with
migration 016 applied:

1. Visit `/community` logged out: confirm the game selector (or its absence with
   one game), feed, and "Log in to post" prompt render; no composer visible.
2. Log in, post a message with no image: confirm it appears at the top of the
   feed immediately (no approval step) and the mobile bottom tab bar / desktop
   header both link to `/community` correctly.
3. Post again with an image attached: confirm the upload completes, the image
   preview shows in the composer before submit, and the image renders in the
   feed after posting.
4. Reply to a post: confirm the reply count updates, the reply appears nested
   under the post, and the reply composer clears itself after a successful
   submit.
5. Delete your own reply, then your own post: confirm both disappear and RLS
   blocks (via the UI simply not showing a Delete button) deleting someone
   else's content.
6. As staff, visit `/admin/community`: confirm the post list, search-by-username
   filtering, and "Remove" action all work; confirm a moderator (non-admin
   staff) role can also reach this page.
7. Confirm `/coming-soon?feature=Community` no longer has any live inbound link
   from the app (nothing routes there anymore for Community specifically).

- [ ] **Step 5: Update ROADMAP.md**

Add a new entry. Locate the `## Follow-ups / tech debt` section (or add a new
`v3.6` section before `## v4.0 — Scale`, matching the `v3.5` pattern already
established) and add:

```markdown
## v3.6 — Community pillar

| # | Task | Status |
|---|------|--------|
| — | Community pillar v1 — per-game discussion feed, one-level replies, optional post images, admin moderation | ✅ |

**★ v3.6 COMPLETE.** The 🤝 Community pillar is live at `/community` — public
per-game feed, posts + one-level replies, optional post images, live-then-moderate
(no approval queue). Known deferred gaps (documented, not bugs): no image
pre-moderation, no orphaned-image cleanup on delete (same accepted gap as Gaming
Exchange listing images), no real-time delivery, no nested replies, no editing,
per-game only (not per-tournament).
```

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark Community pillar v1 complete"
```

---

## Self-Review

**Spec coverage:**
- Data model + RLS + storage bucket (spec's "Data model" section) → Task 1. ✅
- Body length constraint (user's revision #1) → Task 1 (CHECK) + Task 2 (Zod). ✅
- `/community` page: game selector, composer, feed, replies, delete, pagination
  (spec's "Pages" section) → Tasks 4, 5, 6. ✅
- `/admin/community` moderation list (spec's "Pages" section) → Task 7. ✅
- Nav wiring, including the verified desktop-header gap → Task 8. ✅
- Out-of-scope gaps (image moderation, orphaned images — user's revisions #2/#3)
  → documented in this plan's Global Constraints and restated in Task 9's ROADMAP
  entry, not implemented (correctly, per spec). ✅

**Placeholder scan:** no TBD/TODO; every step shows complete code.

**Type consistency check:**
- `PostView`/`ReplyView` field names (`imageUrl`, `authorUsername`,
  `authorDisplayName`, `authorAvatarUrl`, `canDelete`, `replies`) are identical
  between Task 5 (defines them in `PostCard.tsx`) and Task 6 (constructs them in
  `app/(public)/community/page.tsx`).
- `createPost`'s input shape (`{ gameId, body, imageUrl? }`) matches exactly
  between Task 3 (action signature) and Task 4 (`PostComposer`'s call site).
- `AdminCommunityPost` field names match between Task 7's three files (row
  component, list wrapper, page).
- `ReplyState`/`DeleteState` shapes are defined once in Task 3 and imported
  (never redefined) everywhere else they're used (Tasks 5, 7).

No gaps found.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-13-community-pillar.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
