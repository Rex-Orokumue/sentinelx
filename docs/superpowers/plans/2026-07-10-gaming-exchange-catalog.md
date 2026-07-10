# Gaming Exchange — Catalog (#13a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gaming Exchange catalog — browse/filter/detail, multi-image seller listings (→ pending), My Listings, and admin approve/remove — with zero buyer-seller contact and a disabled Buy button. No money moves (that's #13b).

**Architecture:** A new `listing_images` table + public `listing-images` Storage bucket + a status-guard trigger extend the existing `marketplace_listings`. Pure `lib/exchange/*` (schema, image rules) are unit-tested; client upload + server actions + pages are thin over them. Reuses established patterns (tournaments list/detail + game filter, admin queues, dashboard panels, Storage upload).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (Storage + RLS), Vitest.

## Global Constraints

- **Zero buyer-seller contact surface** anywhere; the detail page's only CTA is a **disabled** `🔒 Buy — Protected by Zolarux` button.
- Seller reference on the detail page is **`@username` as a plain link to `/players/[username]` only** — no avatar, Sentinel Score, or other profile info inline.
- **Price floor ₦500** in `listingSchema`.
- **Image rule:** ≥1 image required for `account`/`controller`/`phone`; optional for `coins`/`accessories`/`gift_card`.
- **Status-guard:** only staff can set `active`/`sold`; a seller may only set `removed` on their own listing (DB trigger).
- **No listing-edit UI** in 13a (remove + recreate).
- Only `status='active'` listings are publicly visible (RLS already enforces; queries also filter explicitly).
- Money display via `formatNaira` (`@/lib/format`). Tests: Vitest, colocated `*.test.ts`. Never run concurrent builds (`.next` race).

---

### Task 1: Migration — listing_images, bucket, status guard

**Files:**
- Create: `supabase/migrations/012_listing_images.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `listing_images` table (Row/Insert types), the public `listing-images` bucket, the status-guard trigger. Consumed by Tasks 3–8.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/012_listing_images.sql`:

```sql
-- Multiple images per marketplace listing.
CREATE TABLE public.listing_images (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid        NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  image_url     text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.listing_images (listing_id, display_order);
ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

-- Images are readable when the parent listing is (active is public; own/staff otherwise).
CREATE POLICY "li_select" ON public.listing_images FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id
      AND (m.status = 'active' OR m.seller_id = auth.uid() OR public.is_staff())
  )
);
-- Seller (owner of the parent) or staff may add/remove images.
CREATE POLICY "li_insert" ON public.listing_images FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id AND (m.seller_id = auth.uid() OR public.is_staff())
  )
);
CREATE POLICY "li_delete" ON public.listing_images FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.marketplace_listings m
    WHERE m.id = listing_id AND (m.seller_id = auth.uid() OR public.is_staff())
  )
);

-- Public bucket for listing images (buyers browse them; public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "listing_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'listing-images');
CREATE POLICY "listing_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "listing_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff()));

-- Status guard: a non-staff user may only move their listing to 'removed'.
-- Blocks a seller self-approving (status='active') to bypass moderation.
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND NEW.status <> 'removed' THEN
    RAISE EXCEPTION 'Only staff can set a listing status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_listing_status
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_status();
```

- [ ] **Step 2: Apply to the live project**

Apply via Supabase MCP `apply_migration` (name: `listing_images`, the SQL above).

- [ ] **Step 3: Verify**

Via MCP `execute_sql`:
```sql
SELECT count(*) FROM public.listing_images;
SELECT id, public FROM storage.buckets WHERE id = 'listing-images';
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enforce_listing_status';
```
Expected: `0`; bucket row with `public = true`; the trigger listed.

- [ ] **Step 4: Regenerate types**

Run Supabase MCP `generate_typescript_types` for project `itxubrkbropttfdackmi` and overwrite `lib/supabase/types.ts` (adds `listing_images`).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add supabase/migrations/012_listing_images.sql lib/supabase/types.ts
git commit -m "feat: listing_images table + public bucket + status guard (#13a)"
```

---

### Task 2: Listing schema + category labels

**Files:**
- Create: `lib/exchange/schema.ts`
- Test: `lib/exchange/schema.test.ts`

**Interfaces:**
- Produces: `LISTING_CATEGORIES` (readonly tuple), `ListingCategory`, `CATEGORY_LABELS`, `PRICE_FLOOR_NGN`, `listingSchema` (zod), `ListingInput`. Consumed by Tasks 3, 5, 6, 8.

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listingSchema } from './schema'

const valid = { title: 'FC Mobile stacked account', category: 'account', price: 5000, gameId: undefined, description: '' }

describe('listingSchema', () => {
  it('accepts a valid listing', () => {
    expect(listingSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a price below the ₦500 floor', () => {
    expect(listingSchema.safeParse({ ...valid, price: 400 }).success).toBe(false)
  })
  it('rejects an unknown category', () => {
    expect(listingSchema.safeParse({ ...valid, category: 'nft' }).success).toBe(false)
  })
  it('rejects an empty title', () => {
    expect(listingSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/schema.ts`:

```ts
import { z } from 'zod'

export const LISTING_CATEGORIES = [
  'account', 'coins', 'accessories', 'gift_card', 'controller', 'phone',
] as const
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  account: 'Account',
  coins: 'Coins',
  accessories: 'Accessories',
  gift_card: 'Gift Card',
  controller: 'Controller',
  phone: 'Phone',
}

export const PRICE_FLOOR_NGN = 500

export const listingSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(LISTING_CATEGORIES),
  price: z.coerce.number().int().min(PRICE_FLOOR_NGN, `Price must be at least ₦${PRICE_FLOOR_NGN}`),
  gameId: z.union([z.literal(''), z.string().uuid()]).optional(),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
})

export type ListingInput = z.infer<typeof listingSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/schema.ts lib/exchange/schema.test.ts
git commit -m "feat: exchange listing schema + categories (#13a)"
```

---

### Task 3: Image rules + primary-image helper

**Files:**
- Create: `lib/exchange/images.ts`
- Test: `lib/exchange/images.test.ts`

**Interfaces:**
- Produces: `imageRequired(category): boolean`, `validateImageCount(category, count): boolean`, `primaryImageUrl(images: { image_url: string; display_order: number }[]): string | null`. Consumed by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/images.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { imageRequired, validateImageCount, primaryImageUrl } from './images'

describe('imageRequired', () => {
  it('requires images for account, controller, phone', () => {
    expect(imageRequired('account')).toBe(true)
    expect(imageRequired('controller')).toBe(true)
    expect(imageRequired('phone')).toBe(true)
  })
  it('does not require images for coins, accessories, gift_card', () => {
    expect(imageRequired('coins')).toBe(false)
    expect(imageRequired('accessories')).toBe(false)
    expect(imageRequired('gift_card')).toBe(false)
  })
})

describe('validateImageCount', () => {
  it('fails a required category with zero images', () => {
    expect(validateImageCount('account', 0)).toBe(false)
    expect(validateImageCount('account', 1)).toBe(true)
  })
  it('passes an optional category with zero images', () => {
    expect(validateImageCount('coins', 0)).toBe(true)
  })
})

describe('primaryImageUrl', () => {
  it('returns the lowest display_order image', () => {
    expect(primaryImageUrl([
      { image_url: 'b', display_order: 1 },
      { image_url: 'a', display_order: 0 },
    ])).toBe('a')
  })
  it('returns null for no images', () => {
    expect(primaryImageUrl([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/images.test.ts`
Expected: FAIL — cannot resolve `./images`.

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/images.ts`:

```ts
import type { ListingCategory } from './schema'

const IMAGE_REQUIRED: ReadonlySet<ListingCategory> = new Set(['account', 'controller', 'phone'])

export function imageRequired(category: ListingCategory): boolean {
  return IMAGE_REQUIRED.has(category)
}

export function validateImageCount(category: ListingCategory, count: number): boolean {
  return imageRequired(category) ? count >= 1 : true
}

export function primaryImageUrl(images: { image_url: string; display_order: number }[]): string | null {
  if (images.length === 0) return null
  return [...images].sort((a, b) => a.display_order - b.display_order)[0].image_url
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/images.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/images.ts lib/exchange/images.test.ts
git commit -m "feat: exchange image rules + primary-image helper (#13a)"
```

---

### Task 4: Seller + admin server actions

**Files:**
- Create: `lib/exchange/actions.ts`
- Create: `lib/exchange/admin-actions.ts`

**Interfaces:**
- Consumes: `listingSchema` (Task 2), `validateImageCount` (Task 3), `createClient` (`@/lib/supabase/server`), `requireStaff` (`@/lib/admin/auth`).
- Produces: `createListing(input): Promise<{ id?: string; error?: string }>`; `removeListing(prev, FormData): Promise<ActionState>`; `approveListing(prev, FormData)`, `removeListingAdmin(prev, FormData): Promise<ActionState>`; `type ActionState = { error?: string; success?: boolean } | undefined`.

- [ ] **Step 1: Seller actions**

Create `lib/exchange/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { listingSchema } from './schema'
import { validateImageCount } from './images'

export type ActionState = { error?: string; success?: boolean } | undefined

// Called from the client form with already-uploaded image URLs (ordered).
export async function createListing(input: {
  title: string
  category: string
  price: number
  gameId?: string
  description?: string
  imageUrls: string[]
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to create a listing.' }

  const parsed = listingSchema.safeParse({
    title: input.title,
    category: input.category,
    price: input.price,
    gameId: input.gameId ?? '',
    description: input.description ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const urls = input.imageUrls.slice(0, 8) // sane cap
  if (!validateImageCount(d.category, urls.length)) {
    return { error: 'This category requires at least one image.' }
  }

  const { data: listing, error } = await supabase
    .from('marketplace_listings')
    .insert({
      seller_id: user.id,
      category: d.category,
      title: d.title,
      price: d.price,
      game_id: d.gameId || null,
      description: d.description || null,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !listing) return { error: 'Could not create the listing. Please try again.' }

  if (urls.length > 0) {
    const rows = urls.map((url, i) => ({ listing_id: listing.id, image_url: url, display_order: i }))
    await supabase.from('listing_images').insert(rows)
  }

  revalidatePath('/exchange')
  revalidatePath('/dashboard')
  return { id: listing.id }
}

export async function removeListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  // RLS + the status trigger permit a seller to set their own listing to 'removed'.
  const { error } = await supabase.from('marketplace_listings').update({ status: 'removed' }).eq('id', id)
  if (error) return { error: 'Could not remove the listing.' }
  revalidatePath('/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Admin actions**

Create `lib/exchange/admin-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'

export type ActionState = { error?: string; success?: boolean } | undefined

async function setStatus(id: string, status: 'active' | 'removed'): Promise<ActionState> {
  await requireStaff()
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }
  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  return { success: true }
}

export async function approveListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'active')
}
export async function removeListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'removed')
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/exchange/actions.ts lib/exchange/admin-actions.ts
git commit -m "feat: exchange seller + admin server actions (#13a)"
```

---

### Task 5: Presentational components

**Files:**
- Create: `components/exchange/ListingCard.tsx`
- Create: `components/exchange/ImageGallery.tsx`

**Interfaces:**
- Consumes: `CATEGORY_LABELS`/`ListingCategory` (Task 2); `formatNaira`.
- Produces: `ListingCardData` + `<ListingCard listing />`; `<ImageGallery images title />`. Consumed by Tasks 6, 7.

- [ ] **Step 1: ListingCard**

Create `components/exchange/ListingCard.tsx`:

```tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export interface ListingCardData {
  id: string
  title: string
  price: number
  category: ListingCategory
  gameName: string | null
  primaryImage: string | null
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  return (
    <Link
      href={`/exchange/${listing.id}`}
      className="group block overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 transition-colors hover:border-violet-500/40"
    >
      <div className="relative aspect-square w-full bg-slate-950">
        {listing.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.primaryImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-slate-700">🎮</div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-200">
          {CATEGORY_LABELS[listing.category]}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
        <p className="mt-0.5 font-black text-violet-400">{formatNaira(listing.price)}</p>
        {listing.gameName && <p className="truncate text-[11px] text-slate-500">{listing.gameName}</p>}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: ImageGallery (detail carousel)**

Create `components/exchange/ImageGallery.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0)
  if (images.length === 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-4xl text-slate-700">
        🎮
      </div>
    )
  }
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[active]} alt={title} className="h-full w-full object-contain" />
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border ${i === active ? 'border-violet-500' : 'border-slate-800'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build`
Expected: compiles (unused until Tasks 6–7).

```bash
git add components/exchange/ListingCard.tsx components/exchange/ImageGallery.tsx
git commit -m "feat: exchange listing card + image gallery (#13a)"
```

---

### Task 6: Create-listing form (multi-image upload + reorder)

**Files:**
- Create: `components/exchange/ListingForm.tsx`

**Interfaces:**
- Consumes: `createListing` (Task 4); `LISTING_CATEGORIES`/`CATEGORY_LABELS` (Task 2); `imageRequired` (Task 3); `createClient` (`@/lib/supabase/client`).
- Produces: `<ListingForm games={{ id, name }[]} />`.

- [ ] **Step 1: Write the form**

Create `components/exchange/ListingForm.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createListing } from '@/lib/exchange/actions'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { imageRequired } from '@/lib/exchange/images'

interface Img {
  url: string
}

export function ListingForm({ games }: { games: { id: string; name: string }[] }) {
  const router = useRouter()
  const [category, setCategory] = useState<ListingCategory>('account')
  const [images, setImages] = useState<Img[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
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
    for (const file of files.slice(0, 8 - images.length)) {
      const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('listing-images').upload(path, file, { upsert: false })
      if (upErr) {
        setError('An image failed to upload. Please try again.')
        continue
      }
      const { data } = supabase.storage.from('listing-images').getPublicUrl(path)
      setImages((prev) => [...prev, { url: data.publicUrl }])
    }
    setUploading(false)
  }

  function move(from: number, to: number) {
    setImages((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }
  function removeImg(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    if (imageRequired(category) && images.length === 0) {
      setError('This category needs at least one image.')
      return
    }
    startTransition(async () => {
      const res = await createListing({
        title: String(fd.get('title') ?? ''),
        category,
        price: Number(fd.get('price') ?? 0),
        gameId: String(fd.get('gameId') ?? '') || undefined,
        description: String(fd.get('description') ?? '') || undefined,
        imageUrls: images.map((i) => i.url),
      })
      if (res.error) setError(res.error)
      else if (res.id) router.push(`/exchange/${res.id}`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Title" name="title" required />
      <div className="space-y-1.5">
        <label htmlFor="category" className="text-xs font-medium text-slate-400">Category</label>
        <select
          id="category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ListingCategory)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          {LISTING_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        {imageRequired(category) && <p className="text-[11px] text-amber-400">This category requires at least one image.</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="gameId" className="text-xs font-medium text-slate-400">Game (optional)</label>
        <select id="gameId" name="gameId" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none">
          <option value="">— None —</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <Field label="Price (₦)" name="price" type="number" required />
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-xs font-medium text-slate-400">Description</label>
        <textarea id="description" name="description" rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>

      {/* Images: upload, reorder (drag on desktop, arrows anywhere), remove */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400">Images (first is the cover)</label>
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div
              key={img.url}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); move(Number(e.dataTransfer.getData('text/plain')), i) }}
              className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 text-[10px] text-white">
                <button type="button" onClick={() => move(i, i - 1)} aria-label="Move left">◀</button>
                <button type="button" onClick={() => removeImg(i)} aria-label="Remove">✕</button>
                <button type="button" onClick={() => move(i, i + 1)} aria-label="Move right">▶</button>
              </div>
            </div>
          ))}
          {images.length < 8 && (
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl text-slate-500 hover:border-slate-500">
              +
              <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" />
            </label>
          )}
        </div>
        {uploading && <p className="text-xs text-slate-400">Uploading…</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || uploading}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? 'Publishing…' : 'Submit for review'}
      </button>
      <p className="text-[11px] text-slate-500">Listings are reviewed by an admin before going live.</p>
    </form>
  )
}

function Field({ label, name, type = 'text', required }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input id={name} name={name} type={type} required={required} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
    </div>
  )
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build`
Expected: compiles.

```bash
git add components/exchange/ListingForm.tsx
git commit -m "feat: create-listing form with multi-image upload + reorder (#13a)"
```

---

### Task 7: Public pages — browse, detail, new

**Files:**
- Create: `app/(public)/exchange/page.tsx`
- Create: `app/(public)/exchange/[id]/page.tsx`
- Create: `app/(public)/exchange/new/page.tsx`
- Delete: `app/(public)/exchange/.gitkeep`

**Interfaces:**
- Consumes: `ListingCard`/`ListingCardData` (Task 5), `ImageGallery` (Task 5), `ListingForm` (Task 6), `primaryImageUrl` (Task 3), `CATEGORY_LABELS`/`LISTING_CATEGORIES` (Task 2), `formatNaira`, `createClient` (`@/lib/supabase/server`), `EmptyState`.

- [ ] **Step 1: Browse page**

Create `app/(public)/exchange/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ListingCard, type ListingCardData } from '@/components/exchange/ListingCard'
import { primaryImageUrl } from '@/lib/exchange/images'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Gaming Exchange — SentinelX Esports',
  description: 'Buy and sell gaming accounts, coins, and gear on Sentinel X — protected by Zolarux escrow.',
  openGraph: {
    title: 'Gaming Exchange — SentinelX Esports',
    description: 'Buy and sell gaming accounts, coins, and gear — protected by escrow.',
    url: `${SITE_URL}/exchange`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

type SearchParams = { category?: string }

type Row = {
  id: string
  title: string
  price: number
  category: ListingCategory
  games: { name: string } | { name: string }[] | null
  listing_images: { image_url: string; display_order: number }[] | null
}
function gameName(g: Row['games']): string | null {
  const r = Array.isArray(g) ? g[0] ?? null : g
  return r?.name ?? null
}

export default async function ExchangePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const category = searchParams.category as ListingCategory | undefined
  let q = supabase
    .from('marketplace_listings')
    .select('id, title, price, category, games(name), listing_images(image_url, display_order)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (category && LISTING_CATEGORIES.includes(category)) q = q.eq('category', category)
  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  const listings: ListingCardData[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    price: r.price,
    category: r.category,
    gameName: gameName(r.games),
    primaryImage: primaryImageUrl(r.listing_images ?? []),
  }))

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex items-center justify-between gap-3 py-8">
        <div>
          <h1 className="text-2xl font-black text-white">Gaming Exchange</h1>
          <p className="mt-1 text-sm text-slate-400">Accounts, coins, and gear — protected by Zolarux escrow.</p>
        </div>
        <Link href="/exchange/new" className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500">
          Sell an item
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip label="All" href="/exchange" active={!category} />
        {LISTING_CATEGORIES.map((c) => (
          <FilterChip key={c} label={CATEGORY_LABELS[c]} href={`/exchange?category=${c}`} active={category === c} />
        ))}
      </div>

      {listings.length === 0 ? (
        <EmptyState icon="🛒" title="Nothing listed yet" body="Be the first to list an item on the Gaming Exchange." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-violet-500 bg-violet-600/20 text-violet-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}
    >
      {label}
    </Link>
  )
}
```

- [ ] **Step 2: Detail page**

Create `app/(public)/exchange/[id]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ImageGallery } from '@/components/exchange/ImageGallery'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { primaryImageUrl } from '@/lib/exchange/images'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type NameRef = { username: string | null } | { username: string | null }[] | null
type GameRef = { name: string } | { name: string }[] | null
type ListingRow = {
  id: string
  title: string
  description: string | null
  price: number
  category: ListingCategory
  status: string
  seller: NameRef
  games: GameRef
  listing_images: { image_url: string; display_order: number }[] | null
}
function first<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}
const COLS =
  'id, title, description, price, category, status, ' +
  'seller:profiles!marketplace_listings_seller_id_fkey(username), ' +
  'games(name), listing_images(image_url, display_order)'

async function load(id: string): Promise<ListingRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('marketplace_listings').select(COLS).eq('id', id).maybeSingle()
  return (data as unknown as ListingRow | null) ?? null
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const l = await load(params.id)
  if (!l) return { title: 'Listing not found — SentinelX Esports' }
  const title = `${l.title} — ${formatNaira(l.price)} · Gaming Exchange`
  const image = primaryImageUrl(l.listing_images ?? [])
  return {
    title,
    description: l.description ?? 'On the Sentinel X Gaming Exchange.',
    openGraph: {
      title,
      url: `${SITE_URL}/exchange/${l.id}`,
      siteName: 'SentinelX Esports',
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const l = await load(params.id)
  // Only active listings are public (RLS also hides non-active from non-owners).
  if (!l || l.status !== 'active') notFound()

  const images = [...(l.listing_images ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((i) => i.image_url)
  const sellerName = first(l.seller)?.username ?? null
  const game = first(l.games)?.name ?? null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <ImageGallery images={images} title={l.title} />

      <div className="mt-5">
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold uppercase text-slate-300">
          {CATEGORY_LABELS[l.category]}
        </span>
        <h1 className="mt-2 text-2xl font-black text-white">{l.title}</h1>
        <p className="mt-1 text-2xl font-black text-violet-400">{formatNaira(l.price)}</p>
        {game && <p className="mt-1 text-sm text-slate-400">{game}</p>}
        {/* Seller: @username only, plain link — no other profile info surfaced. */}
        {sellerName && (
          <p className="mt-2 text-sm text-slate-400">
            Seller:{' '}
            <Link href={`/players/${sellerName}`} className="font-semibold text-violet-400 hover:text-violet-300">
              @{sellerName}
            </Link>
          </p>
        )}
      </div>

      {l.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{l.description}</p>}

      <div className="mt-6">
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl bg-slate-800 px-5 py-3 text-sm font-bold text-slate-400"
        >
          🔒 Buy — Protected by Zolarux
        </button>
        <p className="mt-1.5 text-center text-xs text-slate-500">Secure escrow checkout is coming soon.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: New-listing page + remove the stub**

Create `app/(public)/exchange/new/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ListingForm } from '@/components/exchange/ListingForm'

export const metadata: Metadata = { title: 'Sell an item — Gaming Exchange' }

export default async function NewListingPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/exchange/new')

  const { data: games } = await supabase.from('games').select('id, name').eq('active', true).order('name')

  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-6">
      <h1 className="mb-1 text-2xl font-black text-white">Sell an item</h1>
      <p className="mb-6 text-sm text-slate-400">List a gaming account, coins, or gear. An admin reviews every listing before it goes live.</p>
      <ListingForm games={games ?? []} />
    </div>
  )
}
```

Then:
```bash
git rm "app/(public)/exchange/.gitkeep"
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; `/exchange`, `/exchange/[id]`, `/exchange/new` in the route list. (Cast embedded joins with `as unknown as` where the parser trips — already applied.)

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/exchange/page.tsx" "app/(public)/exchange/[id]/page.tsx" "app/(public)/exchange/new/page.tsx"
git commit -m "feat: exchange browse, detail, and new-listing pages (#13a)"
```

---

### Task 8: My Listings (dashboard) + admin moderation

**Files:**
- Create: `components/dashboard/MyListings.tsx`
- Modify: `app/dashboard/page.tsx`
- Create: `components/admin/ExchangeQueueRow.tsx`
- Create: `app/admin/exchange/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `removeListing` (Task 4); `approveListing`/`removeListingAdmin` (Task 4); `formatNaira`; `CATEGORY_LABELS`; `primaryImageUrl` (Task 3).

- [ ] **Step 1: MyListings panel (client — has a Remove form)**

Create `components/dashboard/MyListings.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { removeListing, type ActionState } from '@/lib/exchange/actions'
import { formatNaira } from '@/lib/format'

export interface MyListing {
  id: string
  title: string
  price: number
  status: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  active: { label: 'Active', cls: 'text-emerald-400' },
  removed: { label: 'Removed', cls: 'text-slate-500' },
  sold: { label: 'Sold', cls: 'text-violet-400' },
}

export function MyListings({ listings }: { listings: MyListing[] }) {
  if (listings.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My listings</h2>
      <div className="space-y-2">
        {listings.map((l) => (
          <Row key={l.id} listing={l} />
        ))}
      </div>
    </section>
  )
}

function Row({ listing }: { listing: MyListing }) {
  const [state, action] = useFormState<ActionState, FormData>(removeListing, undefined)
  const s = STATUS[listing.status] ?? { label: listing.status, cls: 'text-slate-400' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{listing.title}</p>
        <p className="text-xs text-slate-500">
          {formatNaira(listing.price)} · <span className={s.cls}>{s.label}</span>
        </p>
      </div>
      {(listing.status === 'pending' || listing.status === 'active') && (
        <form action={action} className="shrink-0">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
            Remove
          </button>
          {state?.error && <span className="ml-2 text-xs text-red-400">{state.error}</span>}
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire MyListings into the dashboard**

In `app/dashboard/page.tsx`, add the import:

```ts
import { MyListings, type MyListing } from '@/components/dashboard/MyListings'
```

Add a fetch to the existing `Promise.all([...])` array (append this element):

```ts
    supabase
      .from('marketplace_listings')
      .select('id, title, price, status')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false }),
```

Bind its result (add to the destructured array as `listingsRes`), map it, and render `<MyListings listings={myListings} />` after `<MyTournaments ... />`:

```ts
  const myListings: MyListing[] = (listingsRes.data ?? []).map((l) => ({
    id: l.id, title: l.title, price: l.price, status: l.status,
  }))
```
```tsx
      <MyListings listings={myListings} />
```

- [ ] **Step 3: Admin moderation row**

Create `components/admin/ExchangeQueueRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { approveListing, removeListingAdmin, type ActionState } from '@/lib/exchange/admin-actions'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export interface PendingListing {
  id: string
  title: string
  price: number
  category: ListingCategory
  sellerName: string
  primaryImage: string | null
  imageCount: number
}

export function ExchangeQueueRow({ listing }: { listing: PendingListing }) {
  const [approveState, approve] = useFormState<ActionState, FormData>(approveListing, undefined)
  const [removeState, remove] = useFormState<ActionState, FormData>(removeListingAdmin, undefined)
  const err = approveState?.error || removeState?.error
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-950">
          {listing.primaryImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.primaryImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl text-slate-700">🎮</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-white">{listing.title}</p>
          <p className="text-xs text-slate-500">
            {CATEGORY_LABELS[listing.category]} · {formatNaira(listing.price)} · {listing.imageCount} image(s) · @{listing.sellerName}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <form action={approve}>
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Approve</button>
        </form>
        <form action={remove}>
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500">Remove</button>
        </form>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Admin exchange page**

Create `app/admin/exchange/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { ExchangeQueueRow, type PendingListing } from '@/components/admin/ExchangeQueueRow'
import { primaryImageUrl } from '@/lib/exchange/images'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ListingCategory } from '@/lib/exchange/schema'

export const metadata: Metadata = { title: 'Exchange · Admin · SentinelX' }

type NameRef = { username: string | null } | { username: string | null }[] | null
type Row = {
  id: string
  title: string
  price: number
  category: ListingCategory
  seller: NameRef
  listing_images: { image_url: string; display_order: number }[] | null
}

export default async function AdminExchangePage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('marketplace_listings')
    .select('id, title, price, category, seller:profiles!marketplace_listings_seller_id_fkey(username), listing_images(image_url, display_order)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const rows = (data ?? []) as unknown as Row[]
  const pending: PendingListing[] = rows.map((r) => {
    const seller = Array.isArray(r.seller) ? r.seller[0] ?? null : r.seller
    return {
      id: r.id,
      title: r.title,
      price: r.price,
      category: r.category,
      sellerName: seller?.username ?? 'seller',
      primaryImage: primaryImageUrl(r.listing_images ?? []),
      imageCount: (r.listing_images ?? []).length,
    }
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Exchange — pending review</h1>
      {pending.length === 0 ? (
        <EmptyState icon="🛒" title="Nothing to review" body="New listings awaiting approval will show up here." />
      ) : (
        <div className="space-y-2">
          {pending.map((l) => (
            <ExchangeQueueRow key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add the admin nav entry**

In `lib/admin/nav.ts`, add to `ADMIN_NAV` (after `TV`):

```ts
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
```

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; `/admin/exchange` in the route list.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/MyListings.tsx app/dashboard/page.tsx components/admin/ExchangeQueueRow.tsx app/admin/exchange/page.tsx lib/admin/nav.ts
git commit -m "feat: My Listings dashboard panel + admin exchange moderation (#13a)"
```

---

### Task 9: Wire the Trade pillar + header

**Files:**
- Modify: `lib/nav/tabs.ts`
- Modify: `lib/nav/tabs.test.ts`
- Modify: `components/shared/SiteHeader.tsx`

- [ ] **Step 1: Update the test first**

In `lib/nav/tabs.test.ts`, add a Trade test alongside the Watch one:

```ts
  it('marks the Trade tab active on /exchange', () => {
    const trade = PILLAR_TABS.find((t) => t.key === 'trade')!
    expect(isTabActive(trade, '/exchange', null)).toBe(true)
    expect(isTabActive(trade, '/coming-soon', 'Trade')).toBe(false)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: FAIL — Trade still points at coming-soon.

- [ ] **Step 3: Point the Trade tab at /exchange**

In `lib/nav/tabs.ts`, change the `trade` entry from:

```ts
  { key: 'trade', label: 'Trade', href: '/coming-soon?feature=Trade', feature: 'Trade', match: null },
```

to:

```ts
  { key: 'trade', label: 'Trade', href: '/exchange', feature: null, match: '/exchange' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/nav/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Add Exchange to the desktop header nav**

In `components/shared/SiteHeader.tsx`, change the `NAV` array to include Exchange:

```ts
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/tv', label: 'TV' },
  { href: '/exchange', label: 'Exchange' },
  { href: '/rankings', label: 'Rankings' },
]
```

- [ ] **Step 6: Commit**

```bash
git add lib/nav/tabs.ts lib/nav/tabs.test.ts components/shared/SiteHeader.tsx
git commit -m "feat: wire Trade pillar + header to /exchange (#13a)"
```

---

### Task 10: Full verification + push

**Files:** none.

- [ ] **Step 1: Full test + type gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (incl. exchange schema/images + the Trade tab test); no type errors.

- [ ] **Step 2: Single clean build**

Run **one** build: `npm run build`
Expected: exit 0; route list includes `/exchange`, `/exchange/[id]`, `/exchange/new`, `/admin/exchange`. (If `ENOENT ... 500.html`, `rm -rf .next` and rebuild once.)

- [ ] **Step 3: Live smoke test (public browse)**

Start the built server (`npm run start`), then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/exchange
curl -s -o /dev/null -w "%{http_code}\n" -X GET http://localhost:3000/admin/exchange
```
Expected: `/exchange` → **200** (shows the "Nothing listed yet" empty state — no active listings yet); `/admin/exchange` → **307** redirect to login (unauthenticated). Stop the server.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** §2 data model (table/bucket/trigger) → Task 1; §2 category rule → Task 3; §3 browse+detail (minimal seller ref, disabled Buy) → Tasks 5,7; §4 create + My Listings → Tasks 6,7,8; §5 admin moderation → Task 8; §6 helpers+tests → Tasks 2,3; §7 wiring+SEO → Tasks 7 (metadata) + 9; §8 scope (no purchase/escrow/contact/edit) respected. All covered.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `ListingCategory`/`LISTING_CATEGORIES`/`CATEGORY_LABELS` (Task 2) used identically in Tasks 3–8. `ListingCardData` (Task 5) built by Task 7 browse. `PendingListing`/`MyListing` shapes match their producers/consumers. `createListing(input)` signature (Task 4) matches the `ListingForm` call site (Task 6); `removeListing`/`approveListing`/`removeListingAdmin` `(prev, FormData)` match their `useFormState` uses. `primaryImageUrl` (Task 3) consumed in Tasks 7,8. `trade` tab shape change (Task 9) matched by the same-task test.
- **Embedded-join note:** the multi-embed selects (`games` + `listing_images` [+ `seller` profiles FK]) are cast `as unknown as Row[]` — same pattern used across the codebase; single embeds resolved with `Array.isArray` guards.
- **Security:** browse/detail filter `status='active'` and RLS hides non-active from non-owners; the status-guard trigger blocks seller self-approval; admin actions are `requireStaff`. Detail page surfaces only `@username`.
