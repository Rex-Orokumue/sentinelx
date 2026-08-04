# Admin Cancel Stuck Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manually resolve a `marketplace_orders` row stuck at `initiated`/`payment_held` (e.g. an abandoned checkout Zolarux never called back about), unblocking the Delete/Mark-as-sold guards on its listing.

**Architecture:** One new server action that replays the exact `order_refunded` transition the real Zolarux webhook already applies (`transitionForEvent` in `lib/exchange/escrow.ts`), writing through the service-role client since `marketplace_orders` has no staff UPDATE policy. One new button on the existing admin order row, visible only while the order is non-terminal.

**Tech Stack:** Next.js 14 App Router Server Actions, Supabase (Postgres + supabase-js, service-role client for the orders write), TypeScript.

## Global Constraints

- `marketplace_orders` writes MUST go through `createAdminClient()` (service-role) — it has no staff UPDATE policy (migration 013: *"writes happen only via the service-role client"*).
- Reuse `transitionForEvent('order_refunded')` for the status pair — do not hardcode a second copy of `{ orderStatus: 'refunded', listingStatus: 'active' }`.
- No new DB migration, no new order/listing status values, no in-app notification (would need a `player_notifications_type_check` migration — out of scope).
- Admin-only (`requireAdmin()`), matching `deleteListingAdmin`/`markListingSoldAdmin` in the same file.

---

### Task 1: `cancelOrderAdmin` server action

**Files:**
- Modify: `lib/exchange/admin-actions.ts`

**Interfaces:**
- Consumes: `transitionForEvent` (existing, `lib/exchange/escrow.ts`), `createAdminClient` (existing, `lib/supabase/admin`), `notify` (existing, `lib/notifications/notify`).
- Produces: `cancelOrderAdmin(_prev: ActionState, formData: FormData): Promise<ActionState>` — for Task 2 (`AdminOrderRow.tsx`). Reuses the existing `ActionState` type already exported from this file.

No automated test — `admin-actions.ts` has no test file today (`deleteListingAdmin`/`markListingSoldAdmin` aren't unit tested either; this is DB-orchestration code following that existing convention). `transitionForEvent('order_refunded')`, the one piece of logic this reuses, is already covered by `lib/exchange/escrow.test.ts`.

- [ ] **Step 1: Add the imports this action needs**

In `lib/exchange/admin-actions.ts`, change:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'
```

to:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { notify } from '@/lib/notifications/notify'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'
import { transitionForEvent } from './escrow'
```

(If the current top of the file differs slightly from the snippet above, apply the same three additions — `createAdminClient`, `notify`, `transitionForEvent` — without disturbing the existing `createClient`/`requireStaff`/`requireAdmin`/`notifyInApp`/`hasAnyOrder`/`hasInProgressOrder` imports.)

- [ ] **Step 2: Add `cancelOrderAdmin`**

Add this function at the end of `lib/exchange/admin-actions.ts`, after `markListingSoldAdmin`:

```ts
export async function cancelOrderAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing order.' }

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('marketplace_orders')
    .select('id, listing_id, buyer_id, status, listing_title, zolarux_order_ref')
    .eq('id', id)
    .maybeSingle()
  if (!order) return { error: 'Order not found.' }
  if (order.status === 'completed' || order.status === 'refunded') {
    return { error: `Order is already ${order.status}.` }
  }

  const transition = transitionForEvent('order_refunded')
  if (!transition) return { error: 'Could not resolve the order.' }

  const { error: orderErr } = await admin
    .from('marketplace_orders')
    .update({ status: transition.orderStatus })
    .eq('id', order.id)
  if (orderErr) return { error: 'Could not update the order.' }

  const { error: listingErr } = await admin
    .from('marketplace_listings')
    .update({ status: transition.listingStatus })
    .eq('id', order.listing_id)
  if (listingErr) return { error: 'Could not update the listing.' }

  await notify({
    playerId: order.buyer_id,
    type: 'escrow_refunded',
    title: order.listing_title,
    dedupeKey: `escrow:${order.zolarux_order_ref}:order_refunded`,
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Using the Supabase MCP `execute_sql` tool (read-only) against project id `itxubrkbropttfdackmi`, confirm a target order to test against, e.g.:

```sql
select id, listing_id, status, zolarux_order_ref from marketplace_orders where status = 'initiated' order by created_at asc limit 1;
```

This step just confirms Task 1's code compiles and the query shapes are valid — Task 2 wires up the UI to actually invoke it, so full end-to-end verification (calling the action and checking the DB row + WhatsApp notification) happens after Task 2.

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/admin-actions.ts
git commit -m "feat(exchange): add admin cancelOrderAdmin action"
```

---

### Task 2: "Cancel order" button on `AdminOrderRow`

**Files:**
- Modify: `components/admin/AdminOrderRow.tsx`

**Interfaces:**
- Consumes: `cancelOrderAdmin`, `type ActionState` (Task 1, `lib/exchange/admin-actions.ts`).

- [ ] **Step 1: Convert to a client component and wire the action**

`AdminOrderRow.tsx` is currently a server-renderable component (no `'use client'`, no hooks) — it needs both now, matching the pattern `ExchangeListingRow.tsx` already uses for its own action-backed buttons (`useFormState`).

Change the top of `components/admin/AdminOrderRow.tsx` from:

```tsx
import { formatNaira, formatDateTime } from '@/lib/format'
import { buildZolaruxWhatsAppUrl } from '@/lib/exchange/escrow'

export interface AdminOrderRow {
  id: string
  listingTitle: string
  amount: number
  status: string
  zolaruxOrderRef: string
  buyerUsername: string | null
  sellerUsername: string | null
  createdAt: string
}
```

to:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { formatNaira, formatDateTime } from '@/lib/format'
import { buildZolaruxWhatsAppUrl } from '@/lib/exchange/escrow'
import { cancelOrderAdmin, type ActionState } from '@/lib/exchange/admin-actions'

export interface AdminOrderRow {
  id: string
  listingTitle: string
  amount: number
  status: string
  zolaruxOrderRef: string
  buyerUsername: string | null
  sellerUsername: string | null
  createdAt: string
}
```

- [ ] **Step 2: Add the button**

Change the component body from:

```tsx
export function AdminOrderRow({ order }: { order: AdminOrderRow }) {
  const href = buildZolaruxWhatsAppUrl({
    listingTitle: order.listingTitle,
    amountNgn: order.amount,
    zolaruxOrderRef: order.zolaruxOrderRef,
    buyerUsername: order.buyerUsername,
    status: order.status,
  })
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{order.listingTitle}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {formatNaira(order.amount)} ·{' '}
          <span className={STATUS_CLS[order.status] ?? 'text-slate-400'}>{order.status}</span> · @
          {order.buyerUsername ?? 'unknown'} → @{order.sellerUsername ?? 'unknown'} ·{' '}
          {formatDateTime(order.createdAt)}
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        Notify Zolarux
      </a>
    </div>
  )
}
```

to:

```tsx
export function AdminOrderRow({ order }: { order: AdminOrderRow }) {
  const [cancelState, cancelAction] = useFormState<ActionState, FormData>(cancelOrderAdmin, undefined)
  const href = buildZolaruxWhatsAppUrl({
    listingTitle: order.listingTitle,
    amountNgn: order.amount,
    zolaruxOrderRef: order.zolaruxOrderRef,
    buyerUsername: order.buyerUsername,
    status: order.status,
  })
  const canCancel = order.status === 'initiated' || order.status === 'payment_held'

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{order.listingTitle}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {formatNaira(order.amount)} ·{' '}
          <span className={STATUS_CLS[order.status] ?? 'text-slate-400'}>{order.status}</span> · @
          {order.buyerUsername ?? 'unknown'} → @{order.sellerUsername ?? 'unknown'} ·{' '}
          {formatDateTime(order.createdAt)}
        </p>
        {cancelState?.error && <p className="mt-1 text-xs text-red-400">{cancelState.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Notify Zolarux
        </a>
        {canCancel && (
          <form
            action={cancelAction}
            onSubmit={(e) => {
              if (!window.confirm(`Cancel this order for "${order.listingTitle}"? This marks it refunded and frees up the listing.`)) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={order.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/10"
            >
              Cancel order
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no existing test touches this component or `admin-actions.ts`).

- [ ] **Step 5: Manual verification**

Start the dev server, open `/admin/exchange`. Under "Recent orders," confirm an order at `initiated` or `payment_held` shows both "Notify Zolarux" and a red "Cancel order" button, while a `completed`/`refunded` order shows only "Notify Zolarux". Click "Cancel order," confirm the dialog, and confirm: the row's status label updates to `refunded`, the "Cancel order" button disappears (now terminal), and the previously-blocked listing's Delete/Mark-as-sold buttons in the "All listings" section below are no longer greyed out. Optionally confirm via the Supabase MCP `execute_sql` tool that `marketplace_orders.status = 'refunded'` and `marketplace_listings.status = 'active'` for the affected rows.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminOrderRow.tsx
git commit -m "feat(exchange): add Cancel order button for stuck admin orders"
```

---

### Task 3: Full suite and build

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: builds successfully with no errors. (Skip and note if another process is actively using `.next/` — see the third-place-match plan's Task 10 for why that can happen in this environment; don't fight over the shared build cache.)
