# Admin Listing Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a way to permanently delete a listing, manually mark one as sold (for off-platform sales), and message the seller on WhatsApp, from a new "All listings" table on the admin Exchange page.

**Architecture:** Two new admin-only server actions (`deleteListingAdmin`, `markListingSoldAdmin`) added to the existing `lib/exchange/admin-actions.ts`, backed by two small pure guard functions (order-history / in-progress-order checks) that are unit tested in isolation — mirroring how `lib/exchange/escrow.ts`'s pure helpers are tested while the thin action wrappers themselves are not (matching this codebase's established convention for server actions). A new pure `buildSellerWhatsAppUrl` helper reuses the existing `parsePlayerPhone` (`lib/phone/number.ts`) and `WhatsAppChip` component already used for admin↔player contact elsewhere. The admin Exchange page grows a new "All listings" section reusing the same query/row-component shape as the existing pending-approval queue.

**Tech Stack:** Next.js 14 Server Components + Server Actions, Supabase (Postgres + RLS), Vitest.

## Global Constraints

- Both new actions are **admin-only** (`requireAdmin()`), not moderator-accessible.
- Delete is blocked entirely if the listing has any `marketplace_orders` row (any status).
- Mark-as-sold is blocked if the listing has an order in status `'initiated'` or `'payment_held'` (i.e. anything not yet `'completed'`/`'refunded'`).
- Both actions notify the seller via the existing `notifyInApp` mechanism (`lib/notifications/inbox.ts`).
- The DB already permits staff to set any `marketplace_listings.status` value (`enforce_listing_status()` trigger, `012_listing_images.sql`) and already has an admin DELETE policy (`ml_admin_delete`, `001_initial_schema.sql:513`) — no RLS/trigger migration needed for the actions themselves, only the notification-type CHECK constraint needs extending.
- Storage cleanup for a deleted listing's images is out of scope for this plan — the `listing_images` rows cascade-delete via FK (`012_listing_images.sql:4`), but the underlying files in the `listing-images` bucket are left orphaned. Acceptable known gap (storage cost only, no correctness impact); not addressed here.
- Follow existing code conventions: thin server-action wrappers in this codebase are not unit tested (see `docs/superpowers/plans/2026-07-28-google-sign-in.md`'s note on the "untested-action convention"); only pure helper functions get unit tests.

---

### Task 1: Extend notification types for listing deletion/mark-sold

**Files:**
- Create: `supabase/migrations/043_exchange_admin_notification_types.sql`
- Modify: `lib/notifications/inbox.ts:3-14`

**Interfaces:**
- Produces: `NotificationType` now additionally includes `'listing_deleted'` and `'listing_sold'`, usable by any caller of `notifyInApp`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/043_exchange_admin_notification_types.sql`:

```sql
-- 043_exchange_admin_notification_types.sql
-- Extends player_notifications.type for the new admin "delete listing" and
-- "mark listing sold" actions (see
-- docs/superpowers/plans/2026-08-02-admin-listing-management.md). Without
-- this, notifyInApp() silently fails its insert (caught by its best-effort
-- try/catch) and the seller never sees a bell notification.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications
  ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'listing_deleted', 'listing_sold'
  ));
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`

Known gotcha in this environment: the Supabase CLI can be unreachable for extended periods on Windows (a schannel TLS check hangs) even though the project's Supabase MCP tools still work. If the CLI push hangs or fails to connect, apply the migration's SQL via the `mcp__claude_ai_Supabase__apply_migration` MCP tool instead (name it `043_exchange_admin_notification_types`, body = the SQL from Step 1), then reconcile migration history with `mcp__claude_ai_Supabase__execute_sql` if `supabase migration list` shows it out of sync afterward.

- [ ] **Step 3: Extend the TypeScript union**

In `lib/notifications/inbox.ts`, change:

```ts
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
  | 'fixture_assigned'
  | 'player_disqualified'
  | 'noshow_needs_decision'
```

to:

```ts
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'listing_deleted'
  | 'listing_sold'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
  | 'fixture_assigned'
  | 'player_disqualified'
  | 'noshow_needs_decision'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/043_exchange_admin_notification_types.sql lib/notifications/inbox.ts
git commit -m "feat(exchange): add listing_deleted/listing_sold notification types"
```

---

### Task 2: Order guard helpers

**Files:**
- Create: `lib/exchange/admin-guards.ts`
- Test: `lib/exchange/admin-guards.test.ts`

**Interfaces:**
- Produces: `hasAnyOrder(orderStatuses: string[]): boolean`, `hasInProgressOrder(orderStatuses: string[]): boolean` — both consumed by Task 4's server actions.

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/admin-guards.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'

describe('hasAnyOrder', () => {
  it('returns false for no orders', () => {
    expect(hasAnyOrder([])).toBe(false)
  })
  it('returns true when any order exists, regardless of status', () => {
    expect(hasAnyOrder(['completed'])).toBe(true)
    expect(hasAnyOrder(['refunded'])).toBe(true)
  })
})

describe('hasInProgressOrder', () => {
  it('returns false for no orders', () => {
    expect(hasInProgressOrder([])).toBe(false)
  })
  it('returns false when all orders are terminal', () => {
    expect(hasInProgressOrder(['completed', 'refunded'])).toBe(false)
  })
  it('returns true when an order is initiated', () => {
    expect(hasInProgressOrder(['initiated'])).toBe(true)
  })
  it('returns true when an order has payment held', () => {
    expect(hasInProgressOrder(['completed', 'payment_held'])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/admin-guards.test.ts`
Expected: FAIL — `Cannot find module './admin-guards'`

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/admin-guards.ts`:

```ts
// Guards for the admin "delete listing" / "mark listing sold" actions
// (lib/exchange/admin-actions.ts). Kept separate from admin-actions.ts
// because that file has a 'use server' directive, which only allows async
// server-action exports — these are plain synchronous helpers so they can
// be unit tested directly.

type GuardOrderStatus = 'initiated' | 'payment_held' | 'completed' | 'refunded'
const IN_PROGRESS_STATUSES: ReadonlySet<GuardOrderStatus> = new Set(['initiated', 'payment_held'])

/** True if the listing has any order at all — blocks permanent delete. */
export function hasAnyOrder(orderStatuses: string[]): boolean {
  return orderStatuses.length > 0
}

/** True if any order hasn't reached a terminal state — blocks manual mark-as-sold. */
export function hasInProgressOrder(orderStatuses: string[]): boolean {
  return orderStatuses.some((s) => IN_PROGRESS_STATUSES.has(s as GuardOrderStatus))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/admin-guards.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/admin-guards.ts lib/exchange/admin-guards.test.ts
git commit -m "feat(exchange): add order guard helpers for admin listing actions"
```

---

### Task 3: Seller WhatsApp contact link

**Files:**
- Create: `lib/exchange/admin-whatsapp.ts`
- Test: `lib/exchange/admin-whatsapp.test.ts`

**Interfaces:**
- Consumes: `parsePlayerPhone(raw, { country }): PlayerPhone | null` from `lib/phone/number.ts` (returns `{ waNumber, e164, display }`); `formatNaira(n): string` from `lib/format.ts`.
- Produces: `buildSellerWhatsAppUrl(args): string | null`, consumed by Task 6's page query. `null` when the seller has no parseable WhatsApp number — callers render `WhatsAppChip` with a `null` url, which already renders a labelled "no WhatsApp" state.

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/admin-whatsapp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSellerWhatsAppUrl } from './admin-whatsapp'

const base = {
  sellerWhatsapp: '08012345678',
  sellerCountry: null as string | null,
  sellerName: 'Chidi',
  listingTitle: 'FC Mobile account',
  price: 15000,
}

describe('buildSellerWhatsAppUrl', () => {
  it('builds a wa.me link with the seller listing details', () => {
    const url = buildSellerWhatsAppUrl(base)!
    expect(url.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toContain('Chidi')
    expect(text).toContain('FC Mobile account')
    expect(text).toContain('₦15,000')
  })

  it('parses against the seller own country', () => {
    const url = buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: '0712345678', sellerCountry: 'Kenya' })!
    expect(url.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it('returns null when the seller has no WhatsApp number', () => {
    expect(buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: null })).toBeNull()
  })

  it('returns null when the number is unparseable', () => {
    expect(buildSellerWhatsAppUrl({ ...base, sellerWhatsapp: 'ask me on IG' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/admin-whatsapp.test.ts`
Expected: FAIL — `Cannot find module './admin-whatsapp'`

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/admin-whatsapp.ts`:

```ts
// A one-tap "message this seller about this listing" link for the admin
// Exchange page, mirroring lib/matches/admin-whatsapp.ts's player-contact
// pattern. Takes the seller's raw stored number + country and returns a
// finished wa.me URL (or null if unreachable) so no phone number reaches
// the client for a seller who can't be reached — components/shared/
// WhatsAppChip.tsx already renders that null case as a labelled dead chip.
import { parsePlayerPhone } from '@/lib/phone/number'
import { formatNaira } from '@/lib/format'

export function buildSellerWhatsAppUrl(args: {
  sellerWhatsapp: string | null | undefined
  sellerCountry?: string | null
  sellerName: string
  listingTitle: string
  price: number
}): string | null {
  const phone = parsePlayerPhone(args.sellerWhatsapp, { country: args.sellerCountry })
  if (!phone) return null
  const text =
    `Hi ${args.sellerName} — SentinelX admin here about your Exchange listing ` +
    `"${args.listingTitle}" (${formatNaira(args.price)}).`
  return `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/admin-whatsapp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/admin-whatsapp.ts lib/exchange/admin-whatsapp.test.ts
git commit -m "feat(exchange): add admin seller WhatsApp contact link"
```

---

### Task 4: Server actions — delete and mark-as-sold

**Files:**
- Modify: `lib/exchange/admin-actions.ts`

**Interfaces:**
- Consumes: `hasAnyOrder`, `hasInProgressOrder` from `./admin-guards` (Task 2); `requireAdmin` from `@/lib/admin/auth`; existing `ActionState`, `notifyInApp`, `createClient`, `revalidatePath` already imported in this file.
- Produces: `deleteListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState>` and `markListingSoldAdmin(_prev: ActionState, formData: FormData): Promise<ActionState>`, both reading `formData.get('id')` — consumed by Task 5's row component as `useFormState` actions, same shape as the existing `approveListing`/`removeListingAdmin`.

No automated test for this task — thin server-action wrappers in this codebase aren't unit tested (see Global Constraints); the guard logic they call is already tested in Task 2, and the actions themselves are exercised manually in Task 7 through the wired-up UI.

- [ ] **Step 1: Add the two actions**

In `lib/exchange/admin-actions.ts`, change the top import block from:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
```

to:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'
```

Then append these two exports at the end of the file (after the existing `approveListing`/`removeListingAdmin`):

```ts
export async function deleteListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }

  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title')
    .eq('id', id)
    .maybeSingle()
  if (!listing) return { error: 'Listing not found.' }

  const { data: orders } = await supabase
    .from('marketplace_orders')
    .select('status')
    .eq('listing_id', id)
  if (hasAnyOrder((orders ?? []).map((o) => o.status))) {
    return { error: "Can't delete — this listing has order history. Use Remove instead." }
  }

  const { error } = await supabase.from('marketplace_listings').delete().eq('id', id)
  if (error) return { error: 'Could not delete the listing.' }

  await notifyInApp({
    playerId: listing.seller_id,
    type: 'listing_deleted',
    title: 'Listing deleted',
    body: `Your listing "${listing.title}" was deleted by an admin.`,
    link: '/exchange',
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markListingSoldAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }

  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title, status')
    .eq('id', id)
    .maybeSingle()
  if (!listing) return { error: 'Listing not found.' }
  if (listing.status === 'sold' || listing.status === 'removed') {
    return { error: `Listing is already ${listing.status}.` }
  }

  const { data: orders } = await supabase
    .from('marketplace_orders')
    .select('status')
    .eq('listing_id', id)
  if (hasInProgressOrder((orders ?? []).map((o) => o.status))) {
    return { error: 'This listing has an order in progress — resolve it before marking sold.' }
  }

  const { error } = await supabase.from('marketplace_listings').update({ status: 'sold' }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }

  await notifyInApp({
    playerId: listing.seller_id,
    type: 'listing_sold',
    title: 'Listing marked as sold',
    body: `Your listing "${listing.title}" was marked as sold by an admin.`,
    link: '/exchange',
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: all existing tests still pass, plus Task 2/3's new tests.

- [ ] **Step 4: Commit**

```bash
git add lib/exchange/admin-actions.ts
git commit -m "feat(exchange): add admin deleteListingAdmin/markListingSoldAdmin actions"
```

---

### Task 5: Admin listing row component

**Files:**
- Create: `components/admin/ExchangeListingRow.tsx`

**Interfaces:**
- Consumes: `deleteListingAdmin`, `markListingSoldAdmin`, `ActionState` from `@/lib/exchange/admin-actions` (Task 4); `formatNaira` from `@/lib/format`; `CATEGORY_LABELS`, `ListingCategory` from `@/lib/exchange/schema`; `WhatsAppChip` from `@/components/shared/WhatsAppChip`.
- Produces: `AdminListing` type and `ExchangeListingRow({ listing }: { listing: AdminListing })` component, consumed by Task 6's page.

- [ ] **Step 1: Write the component**

Create `components/admin/ExchangeListingRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { deleteListingAdmin, markListingSoldAdmin, type ActionState } from '@/lib/exchange/admin-actions'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { WhatsAppChip } from '@/components/shared/WhatsAppChip'

export interface AdminListing {
  id: string
  title: string
  price: number
  category: ListingCategory
  status: 'pending' | 'active' | 'sold' | 'removed' | 'reserved'
  sellerName: string
  primaryImage: string | null
  whatsappUrl: string | null
  canDelete: boolean
  canMarkSold: boolean
}

const STATUS_CLS: Record<AdminListing['status'], string> = {
  pending: 'text-amber-400',
  active: 'text-emerald-400',
  sold: 'text-slate-400',
  removed: 'text-red-400',
  reserved: 'text-sky-400',
}

export function ExchangeListingRow({ listing }: { listing: AdminListing }) {
  const [deleteState, del] = useFormState<ActionState, FormData>(deleteListingAdmin, undefined)
  const [soldState, markSold] = useFormState<ActionState, FormData>(markListingSoldAdmin, undefined)
  const err = deleteState?.error || soldState?.error
  const showMarkSold = listing.status === 'active' || listing.status === 'reserved'

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
            {CATEGORY_LABELS[listing.category]} · {formatNaira(listing.price)} ·{' '}
            <span className={STATUS_CLS[listing.status]}>{listing.status}</span> · @{listing.sellerName}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showMarkSold && (
          <form
            action={markSold}
            onSubmit={(e) => {
              if (!listing.canMarkSold) return
              if (!window.confirm(`Mark "${listing.title}" as sold? This is for sales completed off-platform.`)) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={listing.id} />
            <button
              type="submit"
              disabled={!listing.canMarkSold}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              title={listing.canMarkSold ? undefined : 'Blocked — an order is in progress on this listing.'}
            >
              Mark as sold
            </button>
          </form>
        )}
        <form
          action={del}
          onSubmit={(e) => {
            if (!listing.canDelete) return
            if (!window.confirm(`Permanently delete "${listing.title}"? This can't be undone.`)) {
              e.preventDefault()
            }
          }}
        >
          <input type="hidden" name="id" value={listing.id} />
          <button
            type="submit"
            disabled={!listing.canDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            title={listing.canDelete ? undefined : 'Blocked — this listing has order history.'}
          >
            Delete
          </button>
        </form>
        <WhatsAppChip name={`Message @${listing.sellerName}`} url={listing.whatsappUrl} />
      </div>

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `CATEGORY_LABELS` or `ListingCategory` aren't exported from `lib/exchange/schema.ts` under those exact names, fix the import to match what that file actually exports — `components/admin/ExchangeQueueRow.tsx:5` already imports them this way, so this should already be correct.)

- [ ] **Step 3: Commit**

```bash
git add components/admin/ExchangeListingRow.tsx
git commit -m "feat(exchange): add ExchangeListingRow admin component"
```

---

### Task 6: Wire the "All listings" section into the admin Exchange page

**Files:**
- Modify: `app/admin/exchange/page.tsx`

**Interfaces:**
- Consumes: `ExchangeListingRow`, `type AdminListing` from `@/components/admin/ExchangeListingRow` (Task 5); `buildSellerWhatsAppUrl` from `@/lib/exchange/admin-whatsapp` (Task 3); `hasAnyOrder`, `hasInProgressOrder` from `@/lib/exchange/admin-guards` (Task 2).

- [ ] **Step 1: Add the listings + orders-by-listing query**

In `app/admin/exchange/page.tsx`, add a status filter param and a second query block. Change the `searchParams` type and add a `LISTINGS_PAGE_SIZE` constant near `ORDERS_PAGE_SIZE`:

```ts
const ORDERS_PAGE_SIZE = 10
const LISTINGS_PAGE_SIZE = 100
```

```ts
export default async function AdminExchangePage({
  searchParams,
}: {
  searchParams: { before?: string; status?: string }
}) {
```

After the existing `requireStaff()` + `createClient()` lines, add a listings query (all statuses unless `searchParams.status` narrows it) and an orders-by-listing lookup, run alongside the existing two queries:

```ts
  const VALID_STATUSES = ['pending', 'active', 'sold', 'removed', 'reserved'] as const
  const statusFilter = VALID_STATUSES.includes(searchParams.status as (typeof VALID_STATUSES)[number])
    ? searchParams.status
    : undefined

  let allListingsQuery = supabase
    .from('marketplace_listings')
    .select(
      'id, title, price, category, status, ' +
        'seller:profiles!marketplace_listings_seller_id_fkey(username, whatsapp_number, country), ' +
        'listing_images(image_url, display_order)',
    )
    .order('created_at', { ascending: false })
    .limit(LISTINGS_PAGE_SIZE)
  if (statusFilter) allListingsQuery = allListingsQuery.eq('status', statusFilter)
```

Add it to the existing `Promise.all` (rename the destructured result and include the new query):

```ts
  const [{ data }, { data: orderData }, { data: allListingsData }] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('id, title, price, category, seller:profiles!marketplace_listings_seller_id_fkey(username), listing_images(image_url, display_order)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    ordersQuery,
    allListingsQuery,
  ])
```

- [ ] **Step 2: Fetch order statuses for the listed listings and build `AdminListing[]`**

Right after the `Promise.all` block (still inside the component, before the `return`), add:

```ts
  type ListingSeller = { username: string | null; whatsapp_number: string | null; country: string | null }
  type AllListingRow = {
    id: string
    title: string
    price: number
    category: ListingCategory
    status: AdminListing['status']
    seller: ListingSeller | ListingSeller[] | null
    listing_images: { image_url: string; display_order: number }[] | null
  }
  const allListingRows = (allListingsData ?? []) as unknown as AllListingRow[]
  const listingIds = allListingRows.map((r) => r.id)

  const { data: orderStatusData } =
    listingIds.length === 0
      ? { data: [] as { listing_id: string; status: string }[] }
      : await supabase.from('marketplace_orders').select('listing_id, status').in('listing_id', listingIds)

  const orderStatusesByListing = new Map<string, string[]>()
  for (const o of orderStatusData ?? []) {
    const list = orderStatusesByListing.get(o.listing_id) ?? []
    list.push(o.status)
    orderStatusesByListing.set(o.listing_id, list)
  }

  const allListings: AdminListing[] = allListingRows.map((r) => {
    const seller = Array.isArray(r.seller) ? r.seller[0] ?? null : r.seller
    const orderStatuses = orderStatusesByListing.get(r.id) ?? []
    return {
      id: r.id,
      title: r.title,
      price: r.price,
      category: r.category,
      status: r.status,
      sellerName: seller?.username ?? 'seller',
      primaryImage: primaryImageUrl(r.listing_images ?? []),
      whatsappUrl: buildSellerWhatsAppUrl({
        sellerWhatsapp: seller?.whatsapp_number ?? null,
        sellerCountry: seller?.country ?? null,
        sellerName: seller?.username ?? 'seller',
        listingTitle: r.title,
        price: r.price,
      }),
      canDelete: !hasAnyOrder(orderStatuses),
      canMarkSold: !hasInProgressOrder(orderStatuses),
    }
  })
```

- [ ] **Step 3: Add the imports**

At the top of `app/admin/exchange/page.tsx`, add:

```ts
import { ExchangeListingRow, type AdminListing } from '@/components/admin/ExchangeListingRow'
import { buildSellerWhatsAppUrl } from '@/lib/exchange/admin-whatsapp'
import { hasAnyOrder, hasInProgressOrder } from '@/lib/exchange/admin-guards'
```

- [ ] **Step 4: Render the "All listings" section with status filter tabs**

Add this JSX block after the existing "Recent orders" section, before the closing `</div>` of the component's returned JSX:

```tsx
      <h2 className="mb-4 mt-10 text-base font-bold text-white">All listings</h2>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['all', ...VALID_STATUSES] as const).map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/exchange' : `/admin/exchange?status=${s}`}
            className={`rounded-full border px-3 py-1 font-bold ${
              (s === 'all' && !statusFilter) || s === statusFilter
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-slate-800 text-slate-400 hover:border-slate-600'
            }`}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>
      {allListings.length === 0 ? (
        <EmptyState icon="🛒" title="No listings" body="No listings match this filter." />
      ) : (
        <div className="space-y-2">
          {allListings.map((l) => (
            <ExchangeListingRow key={l.id} listing={l} />
          ))}
        </div>
      )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (596+ from before this plan, plus the new ones from Tasks 2–3).

- [ ] **Step 7: Commit**

```bash
git add app/admin/exchange/page.tsx
git commit -m "feat(exchange): add All listings section with delete/mark-sold/WhatsApp to admin Exchange page"
```

---

### Task 7: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background) and note which port it binds to (falls back past 3000 if already in use).

- [ ] **Step 2: Seed/confirm test data**

Sign in as an admin. Make sure at least one `active` listing with no orders exists (delete-eligible), and if possible one listing with a `marketplace_orders` row (delete-blocked) — reuse whatever test listings already exist from prior manual QA, or create one via `/exchange/new` with a non-admin test account.

- [ ] **Step 3: Verify the "All listings" table renders**

Navigate to `/admin/exchange`. Confirm the new "All listings" section appears below "Recent orders", with status filter tabs, and that switching tabs (`?status=active`, etc.) filters the rows.

- [ ] **Step 4: Verify Delete — happy path**

On a listing with no orders, click Delete, confirm the browser confirm dialog, and verify: the listing disappears from the table, `/exchange` no longer lists it, and (if notification UI is easy to check) the seller has a "Listing deleted" notification.

- [ ] **Step 5: Verify Delete — blocked path**

On a listing with an order, confirm the Delete button is disabled with a tooltip explaining why.

- [ ] **Step 6: Verify Mark as sold — happy path**

On an `active` listing with no in-progress order, click Mark as sold, confirm, and verify its status flips to `sold` in the table and on `/exchange`.

- [ ] **Step 7: Verify Mark as sold — blocked path**

On a listing with a `payment_held`/`initiated` order, confirm the Mark as sold button is disabled.

- [ ] **Step 8: Verify the WhatsApp chip**

For a listing whose seller has a valid `whatsapp_number`, click "Message @seller" and confirm it opens `https://wa.me/...` with the expected prefilled text. For a seller with no/invalid number, confirm the chip renders the "no WhatsApp" dead state instead of a link.

- [ ] **Step 9: Confirm moderators are blocked**

Sign in as a moderator-only account (or temporarily check `requireAdmin` redirect logic by inspecting the code path) and confirm Delete/Mark-sold aren't reachable — `requireAdmin()` redirects non-admin staff to `/admin`.

No commit for this task — it's verification of Tasks 1–6's already-committed work.
