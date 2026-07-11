# Gaming Exchange Purchase + Zolarux Escrow (#13b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the Gaming Exchange "Buy" path — hand a purchase to Zolarux escrow, then reflect the escrow lifecycle back to buyer and seller.

**Architecture:** A thin local mirror table (`marketplace_orders`) tracks each purchase; a server action initiates escrow with Zolarux and redirects the buyer to pay; a webhook reflects three Zolarux events (`payment_held` → `delivery_confirmed`/`order_refunded`) onto the order + listing. All escrow logic (payment, custody, delivery, disputes, release/refund) lives on Zolarux — SentinelX only initiates and reflects. Pure decision logic is isolated in `lib/exchange/escrow.ts` and unit-tested; the action and webhook are thin I/O wrappers.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), Vitest, existing Termii notification helper.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-gaming-exchange-purchase-escrow-design.md`.
- Money is NGN. `marketplace_listings.price` is `integer` NGN. Zolarux `amount` is in **kobo** = `price * 100`.
- Purchase amount is authoritative **server-side** (from `listing.price`) — never trust a client value.
- Zolarux auth (both directions): `Authorization: Bearer <SENTINELX_API_SECRET>`.
- Env (already in `.env.local`): `SENTINELX_API_SECRET`, `ZOLARUX_INITIATE_URL=https://zolarux.com.ng/api/sentinelx/escrow/initiate`. Also existing: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.
- `return_url` sent to Zolarux: `https://sentinelxesports.vercel.app/dashboard?tab=orders`.
- Updated-at trigger function in this repo is `public.set_updated_at()` (NOT `handle_updated_at`).
- Webhook runs as the Supabase **service-role** client (`createAdminClient()`), which bypasses RLS but still fires triggers. The `enforce_listing_status` trigger must be taught to allow `service_role`, or the webhook cannot set listing status.
- Notifications are best-effort via `notify()` — never throw into the primary action.
- Mobile-first (design at 375px). Follow existing panel styling.
- Verify with `npx tsc --noEmit` + `npm run build` before pushing. Push to `origin/main` after both pass (per user workflow).

---

## File Structure

- **Create** `supabase/migrations/013_marketplace_orders.sql` — new table + RLS + trigger; alter listing status CHECK; drop legacy columns; extend `enforce_listing_status`; extend `notifications.type` CHECK.
- **Create** `lib/exchange/escrow.ts` — pure logic: kobo conversion, initiate-payload builder, event→transition map, purchase validation, constant-time bearer check.
- **Create** `lib/exchange/escrow.test.ts` — unit tests for the pure logic.
- **Create** `lib/exchange/purchase.ts` — `initiateEscrowPurchase` server action (thin I/O).
- **Create** `app/api/zolarux/webhook/route.ts` — webhook handler (thin I/O).
- **Create** `components/exchange/BuyButton.tsx` — client buy control.
- **Create** `components/dashboard/MyOrders.tsx` — buyer purchases panel.
- **Create** `components/dashboard/MySales.tsx` — seller sales panel.
- **Modify** `lib/notifications/templates.ts` — add three escrow template variants.
- **Modify** `app/(public)/exchange/[id]/page.tsx` — replace disabled button with `BuyButton` + state logic.
- **Modify** `app/dashboard/page.tsx` — fetch + render `MyOrders` / `MySales`; add `reserved` label to `MyListings` map.
- **Modify** `components/dashboard/MyListings.tsx` — add `reserved` status label.
- **Regenerate** `lib/supabase/types.ts` after the migration.

---

## Task 1: Database migration + regenerated types

**Files:**
- Create: `supabase/migrations/013_marketplace_orders.sql`
- Modify (regen): `lib/supabase/types.ts`

**Interfaces:**
- Produces: table `public.marketplace_orders(id, listing_id, buyer_id, seller_id, zolarux_order_id, zolarux_order_ref UNIQUE, amount int, listing_title, status, created_at, updated_at)`; `marketplace_listings.status` now allows `reserved`; columns `escrow_status`/`zolarux_reference` dropped; `notifications.type` allows escrow types; `enforce_listing_status` permits `service_role`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/013_marketplace_orders.sql`:

```sql
-- #13b Gaming Exchange purchase + Zolarux escrow.
-- Local mirror of Zolarux escrow orders + listing lifecycle wiring.

-- 1. Orders table -------------------------------------------------
CREATE TABLE public.marketplace_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid        NOT NULL REFERENCES public.marketplace_listings(id),
  buyer_id          uuid        NOT NULL REFERENCES public.profiles(id),
  seller_id         uuid        NOT NULL REFERENCES public.profiles(id),
  zolarux_order_id  text        NOT NULL,
  zolarux_order_ref text        NOT NULL UNIQUE,
  amount            integer     NOT NULL,          -- NGN, snapshot of listing.price
  listing_title     text        NOT NULL,          -- snapshot
  status            text        NOT NULL DEFAULT 'initiated'
                      CHECK (status IN ('initiated', 'payment_held', 'completed', 'refunded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.marketplace_orders (buyer_id);
CREATE INDEX ON public.marketplace_orders (seller_id);
CREATE INDEX ON public.marketplace_orders (listing_id);

CREATE TRIGGER set_marketplace_orders_updated_at
  BEFORE UPDATE ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- Buyer or seller can read their own orders; staff can read all.
-- No INSERT/UPDATE/DELETE policies: writes happen only via the service-role
-- client (buy action insert + webhook updates), which bypasses RLS.
CREATE POLICY "mo_select" ON public.marketplace_orders
  FOR SELECT USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id OR public.is_staff()
  );

-- 2. Listing status: add 'reserved' ------------------------------
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status IN ('pending', 'active', 'sold', 'removed', 'reserved'));

-- 3. Drop the unused placeholder columns (state lives in marketplace_orders now)
ALTER TABLE public.marketplace_listings DROP COLUMN escrow_status;
ALTER TABLE public.marketplace_listings DROP COLUMN zolarux_reference;

-- 4. Let the escrow webhook (service_role) drive listing status.
--    Sellers still may only move a listing to 'removed'.
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND current_user <> 'service_role'
     AND NEW.status <> 'removed' THEN
    RAISE EXCEPTION 'Only staff can set a listing status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Allow escrow notification types in the audit log.
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('registration_confirmed', 'fixture_reminder',
                  'result_confirmed', 'prize_credited',
                  'escrow_sale', 'escrow_completed', 'escrow_refunded'));
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool (project id `itxubrkbropttfdackmi`), name `013_marketplace_orders`, with the SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify the schema with rolled-back SQL**

Run via Supabase MCP `execute_sql`:

```sql
-- status CHECK now includes 'reserved'
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'marketplace_listings_status_check';
-- legacy columns gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'marketplace_listings' AND column_name IN ('escrow_status','zolarux_reference');
-- orders table + RLS present
SELECT relrowsecurity FROM pg_class WHERE relname = 'marketplace_orders';
```
Expected: constraint def lists `reserved`; second query returns **zero rows**; `relrowsecurity = t`.

- [ ] **Step 4: Regenerate Supabase types**

Use the Supabase MCP `generate_typescript_types` tool and overwrite `lib/supabase/types.ts` with the result.
Expected: `marketplace_orders` appears in the `Database` type; `marketplace_listings` no longer has `escrow_status`/`zolarux_reference`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no code references the dropped columns yet).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/013_marketplace_orders.sql lib/supabase/types.ts
git commit -m "feat: #13b marketplace_orders table + escrow schema wiring"
```

---

## Task 2: Pure escrow logic (`lib/exchange/escrow.ts`)

**Files:**
- Create: `lib/exchange/escrow.ts`
- Test: `lib/exchange/escrow.test.ts`

**Interfaces:**
- Produces:
  - `ESCROW_RETURN_URL: string`
  - `toKobo(ngn: number): number`
  - `buildInitiatePayload(args: { listingId: string; listingTitle: string; buyerId: string; sellerId: string; priceNgn: number }): { buyer_id: string; seller_id: string; listing_id: string; listing_title: string; amount: number; return_url: string }`
  - `ZolaruxEvent = 'payment_held' | 'delivery_confirmed' | 'order_refunded'`
  - `transitionForEvent(event: string): { orderStatus: OrderStatus; listingStatus: string } | null`
  - `OrderStatus = 'initiated' | 'payment_held' | 'completed' | 'refunded'`
  - `validatePurchase(args: { userId: string | null; listingStatus: string; sellerId: string }): string | null`
  - `bearerOk(header: string | null, secret: string | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

Create `lib/exchange/escrow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  toKobo,
  buildInitiatePayload,
  transitionForEvent,
  validatePurchase,
  bearerOk,
  ESCROW_RETURN_URL,
} from './escrow'

describe('toKobo', () => {
  it('converts NGN to kobo', () => {
    expect(toKobo(500)).toBe(50000)
    expect(toKobo(1)).toBe(100)
  })
})

describe('buildInitiatePayload', () => {
  it('builds the Zolarux initiate body with kobo amount and return_url', () => {
    const body = buildInitiatePayload({
      listingId: 'l1',
      listingTitle: 'FC Mobile account',
      buyerId: 'b1',
      sellerId: 's1',
      priceNgn: 2500,
    })
    expect(body).toEqual({
      buyer_id: 'b1',
      seller_id: 's1',
      listing_id: 'l1',
      listing_title: 'FC Mobile account',
      amount: 250000,
      return_url: ESCROW_RETURN_URL,
    })
  })
})

describe('transitionForEvent', () => {
  it('maps payment_held to held order + reserved listing', () => {
    expect(transitionForEvent('payment_held')).toEqual({
      orderStatus: 'payment_held',
      listingStatus: 'reserved',
    })
  })
  it('maps delivery_confirmed to completed order + sold listing', () => {
    expect(transitionForEvent('delivery_confirmed')).toEqual({
      orderStatus: 'completed',
      listingStatus: 'sold',
    })
  })
  it('maps order_refunded to refunded order + active listing', () => {
    expect(transitionForEvent('order_refunded')).toEqual({
      orderStatus: 'refunded',
      listingStatus: 'active',
    })
  })
  it('returns null for an unknown event', () => {
    expect(transitionForEvent('nonsense')).toBeNull()
  })
})

describe('validatePurchase', () => {
  it('rejects a logged-out user', () => {
    expect(validatePurchase({ userId: null, listingStatus: 'active', sellerId: 's1' })).toMatch(/log in/i)
  })
  it('rejects buying your own listing', () => {
    expect(validatePurchase({ userId: 's1', listingStatus: 'active', sellerId: 's1' })).toMatch(/your own/i)
  })
  it('rejects a listing that is not active', () => {
    expect(validatePurchase({ userId: 'b1', listingStatus: 'reserved', sellerId: 's1' })).toMatch(/no longer available/i)
  })
  it('accepts a valid purchase', () => {
    expect(validatePurchase({ userId: 'b1', listingStatus: 'active', sellerId: 's1' })).toBeNull()
  })
})

describe('bearerOk', () => {
  it('accepts a matching bearer header', () => {
    expect(bearerOk('Bearer secret123', 'secret123')).toBe(true)
  })
  it('rejects a mismatched token', () => {
    expect(bearerOk('Bearer wrong', 'secret123')).toBe(false)
  })
  it('rejects a missing header', () => {
    expect(bearerOk(null, 'secret123')).toBe(false)
  })
  it('rejects when the secret is unset', () => {
    expect(bearerOk('Bearer secret123', undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/exchange/escrow.test.ts`
Expected: FAIL — `Cannot find module './escrow'`.

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/escrow.ts`:

```ts
import { timingSafeEqual } from 'crypto'

export const ESCROW_RETURN_URL = 'https://sentinelxesports.vercel.app/dashboard?tab=orders'

export type OrderStatus = 'initiated' | 'payment_held' | 'completed' | 'refunded'

export function toKobo(ngn: number): number {
  return Math.round(ngn * 100)
}

export function buildInitiatePayload(args: {
  listingId: string
  listingTitle: string
  buyerId: string
  sellerId: string
  priceNgn: number
}) {
  return {
    buyer_id: args.buyerId,
    seller_id: args.sellerId,
    listing_id: args.listingId,
    listing_title: args.listingTitle,
    amount: toKobo(args.priceNgn),
    return_url: ESCROW_RETURN_URL,
  }
}

// Zolarux event -> local order status + listing status.
const TRANSITIONS: Record<string, { orderStatus: OrderStatus; listingStatus: string }> = {
  payment_held: { orderStatus: 'payment_held', listingStatus: 'reserved' },
  delivery_confirmed: { orderStatus: 'completed', listingStatus: 'sold' },
  order_refunded: { orderStatus: 'refunded', listingStatus: 'active' },
}

export function transitionForEvent(
  event: string,
): { orderStatus: OrderStatus; listingStatus: string } | null {
  return TRANSITIONS[event] ?? null
}

export function validatePurchase(args: {
  userId: string | null
  listingStatus: string
  sellerId: string
}): string | null {
  if (!args.userId) return 'Please log in to buy.'
  if (args.userId === args.sellerId) return 'You cannot buy your own listing.'
  if (args.listingStatus !== 'active') return 'This listing is no longer available.'
  return null
}

export function bearerOk(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/exchange/escrow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/escrow.ts lib/exchange/escrow.test.ts
git commit -m "feat: #13b pure escrow logic (payload, transitions, guards)"
```

---

## Task 3: Escrow notification templates

**Files:**
- Modify: `lib/notifications/templates.ts`

**Interfaces:**
- Consumes: existing `TemplateInput` union + `renderTemplate`.
- Produces: three new `TemplateInput` variants — `{ type: 'escrow_sale'; title: string }`, `{ type: 'escrow_completed'; title: string }`, `{ type: 'escrow_refunded'; title: string }`.

- [ ] **Step 1: Add the template variants**

In `lib/notifications/templates.ts`, extend the `TemplateInput` union (add after the `prize_credited` line):

```ts
  | { type: 'escrow_sale'; title: string }
  | { type: 'escrow_completed'; title: string }
  | { type: 'escrow_refunded'; title: string }
```

And add these cases inside the `renderTemplate` switch (before the closing brace):

```ts
    case 'escrow_sale':
      return {
        templateName: 'escrow_sale',
        body: `💰 You've got a sale on Sentinel X! "${input.title}" — funds are held safely in Zolarux escrow. Deliver to the buyer now; you're paid once they confirm.`,
      }
    case 'escrow_completed':
      return {
        templateName: 'escrow_completed',
        body: `✅ Your Sentinel X escrow order for "${input.title}" is complete — funds have been released to the seller. Enjoy!`,
      }
    case 'escrow_refunded':
      return {
        templateName: 'escrow_refunded',
        body: `↩️ Your Sentinel X escrow order for "${input.title}" has been refunded. The money is on its way back to you.`,
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/templates.ts
git commit -m "feat: #13b escrow WhatsApp notification templates"
```

---

## Task 4: Buy server action (`lib/exchange/purchase.ts`)

**Files:**
- Create: `lib/exchange/purchase.ts`

**Interfaces:**
- Consumes: `buildInitiatePayload`, `validatePurchase` from `./escrow`; `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`.
- Produces: `initiateEscrowPurchase(listingId: string): Promise<{ paymentLink?: string; error?: string }>`.

- [ ] **Step 1: Write the implementation**

Create `lib/exchange/purchase.ts`:

```ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildInitiatePayload, validatePurchase } from './escrow'

const GENERIC_ERROR = 'Secure checkout is temporarily unavailable. Please try again shortly.'

export async function initiateEscrowPurchase(
  listingId: string,
): Promise<{ paymentLink?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Load the listing (RLS lets anyone read an 'active' listing).
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('id, title, price, status, seller_id')
    .eq('id', listingId)
    .maybeSingle()

  if (!listing) return { error: 'This listing could not be found.' }

  const guard = validatePurchase({
    userId: user?.id ?? null,
    listingStatus: listing.status,
    sellerId: listing.seller_id,
  })
  if (guard) return { error: guard }

  const secret = process.env.SENTINELX_API_SECRET
  const url = process.env.ZOLARUX_INITIATE_URL
  if (!secret || !url) return { error: GENERIC_ERROR }

  const payload = buildInitiatePayload({
    listingId: listing.id,
    listingTitle: listing.title,
    buyerId: user!.id,
    sellerId: listing.seller_id,
    priceNgn: listing.price,
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { error: GENERIC_ERROR }
  }
  if (!res.ok) return { error: GENERIC_ERROR }

  let json: { order_id?: string; order_ref?: string; payment_link?: string }
  try {
    json = await res.json()
  } catch {
    return { error: GENERIC_ERROR }
  }
  if (!json.order_id || !json.order_ref || !json.payment_link) return { error: GENERIC_ERROR }

  // Record the local mirror row via the service-role client (no client INSERT policy).
  const admin = createAdminClient()
  const { error: insertErr } = await admin.from('marketplace_orders').insert({
    listing_id: listing.id,
    buyer_id: user!.id,
    seller_id: listing.seller_id,
    zolarux_order_id: json.order_id,
    zolarux_order_ref: json.order_ref,
    amount: listing.price,
    listing_title: listing.title,
    status: 'initiated',
  })
  if (insertErr) return { error: GENERIC_ERROR }

  return { paymentLink: json.payment_link }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/exchange/purchase.ts
git commit -m "feat: #13b initiateEscrowPurchase server action"
```

---

## Task 5: Zolarux webhook route

**Files:**
- Create: `app/api/zolarux/webhook/route.ts`

**Interfaces:**
- Consumes: `bearerOk`, `transitionForEvent` from `@/lib/exchange/escrow`; `createAdminClient`; `notify` from `@/lib/notifications/notify`.
- Produces: `POST` handler at `/api/zolarux/webhook`.

- [ ] **Step 1: Write the implementation**

Create `app/api/zolarux/webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bearerOk, transitionForEvent } from '@/lib/exchange/escrow'
import { notify } from '@/lib/notifications/notify'

export const runtime = 'nodejs'

// Machine-to-machine from Zolarux. Reflects escrow state onto the local order + listing.
export async function POST(req: NextRequest) {
  if (!bearerOk(req.headers.get('authorization'), process.env.SENTINELX_API_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { event?: string; order_ref?: string }
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const transition = body.event ? transitionForEvent(body.event) : null
  if (!transition || !body.order_ref) {
    return new NextResponse('Unknown event', { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('marketplace_orders')
    .select('id, listing_id, buyer_id, seller_id, listing_title, status')
    .eq('zolarux_order_ref', body.order_ref)
    .maybeSingle()

  if (!order) return new NextResponse('Order not found', { status: 404 })

  // Idempotent: Zolarux may retry a delivered webhook.
  if (order.status === transition.orderStatus) return new NextResponse('ok', { status: 200 })

  await admin
    .from('marketplace_orders')
    .update({ status: transition.orderStatus })
    .eq('id', order.id)

  await admin
    .from('marketplace_listings')
    .update({ status: transition.listingStatus })
    .eq('id', order.listing_id)

  // Best-effort WhatsApp notification (never throws).
  if (body.event === 'payment_held') {
    await notify({
      playerId: order.seller_id,
      type: 'escrow_sale',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:payment_held`,
    })
  } else if (body.event === 'delivery_confirmed') {
    await notify({
      playerId: order.buyer_id,
      type: 'escrow_completed',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:delivery_confirmed`,
    })
  } else if (body.event === 'order_refunded') {
    await notify({
      playerId: order.buyer_id,
      type: 'escrow_refunded',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:order_refunded`,
    })
  }

  return new NextResponse('ok', { status: 200 })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manually exercise the webhook against the live DB**

This verifies the end-to-end webhook path (bearer, lookup, transition, idempotency) without the full buy flow.

1. Insert a throwaway order via Supabase MCP `execute_sql` (use a real `active` listing id + its seller, and any profile id as buyer; note the listing's original status):

```sql
INSERT INTO public.marketplace_orders
  (listing_id, buyer_id, seller_id, zolarux_order_id, zolarux_order_ref, amount, listing_title, status)
SELECT m.id, m.seller_id, m.seller_id, 'test-oid', 'test-ref-13b', m.price, m.title, 'initiated'
FROM public.marketplace_listings m WHERE m.status = 'active' LIMIT 1;
```

2. Start the dev server (`npm run dev`) and POST a `payment_held` event (replace `$SECRET` with `SENTINELX_API_SECRET`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/zolarux/webhook \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"event":"payment_held","order_ref":"test-ref-13b","order_id":"test-oid","listing_id":"x"}'
```
Expected: `200`. A bad bearer returns `401`; `{"event":"bogus",...}` returns `400`; a repeat `payment_held` returns `200` (idempotent, no second state change).

3. Verify + clean up via `execute_sql`:

```sql
SELECT o.status AS order_status, l.status AS listing_status
FROM public.marketplace_orders o JOIN public.marketplace_listings l ON l.id = o.listing_id
WHERE o.zolarux_order_ref = 'test-ref-13b';
-- Expected: order_status = 'payment_held', listing_status = 'reserved'

-- restore the listing and remove the test order
UPDATE public.marketplace_listings SET status = 'active'
WHERE id = (SELECT listing_id FROM public.marketplace_orders WHERE zolarux_order_ref = 'test-ref-13b');
DELETE FROM public.marketplace_orders WHERE zolarux_order_ref = 'test-ref-13b';
```
Expected: first query shows `payment_held` / `reserved`, confirming the service-role bypass in `enforce_listing_status` works.

- [ ] **Step 4: Commit**

```bash
git add app/api/zolarux/webhook/route.ts
git commit -m "feat: #13b Zolarux escrow webhook — reflect state onto order + listing"
```

---

## Task 6: Buy button + listing detail wiring

**Files:**
- Create: `components/exchange/BuyButton.tsx`
- Modify: `app/(public)/exchange/[id]/page.tsx`

**Interfaces:**
- Consumes: `initiateEscrowPurchase` from `@/lib/exchange/purchase`.
- Produces: `<BuyButton listingId viewerState />` where `viewerState` is `'guest' | 'owner' | 'buyable'`.

- [ ] **Step 1: Write the BuyButton component**

Create `components/exchange/BuyButton.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { initiateEscrowPurchase } from '@/lib/exchange/purchase'

type ViewerState = 'guest' | 'owner' | 'buyable'

export function BuyButton({
  listingId,
  viewerState,
}: {
  listingId: string
  viewerState: ViewerState
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (viewerState === 'owner') {
    return <p className="text-center text-xs text-slate-500">This is your listing.</p>
  }

  if (viewerState === 'guest') {
    return (
      <Link
        href={`/login?next=/exchange/${listingId}`}
        className="block w-full rounded-xl bg-violet-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-violet-500"
      >
        Log in to buy
      </Link>
    )
  }

  function onBuy() {
    setError(null)
    startTransition(async () => {
      const res = await initiateEscrowPurchase(listingId)
      if (res.paymentLink) {
        window.location.href = res.paymentLink
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBuy}
        disabled={pending}
        className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Starting secure checkout…' : '🔒 Buy — Protected by Zolarux'}
      </button>
      {error && <p className="mt-1.5 text-center text-xs text-red-400">{error}</p>}
      <p className="mt-1.5 text-center text-xs text-slate-500">
        Payment is held in Zolarux escrow and released only after you confirm delivery.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the listing detail page**

In `app/(public)/exchange/[id]/page.tsx`:

1. Add imports near the top:

```tsx
import { BuyButton } from '@/components/exchange/BuyButton'
```

2. Add `seller_id` to the `ListingRow` type and to `COLS`:
   - In `type ListingRow`, add `seller_id: string`.
   - In `COLS`, change the leading fields to include `seller_id`: `'id, title, description, price, category, status, seller_id, '` (keep the rest unchanged).

3. In `ListingDetailPage`, after computing `game`, determine the viewer:

```tsx
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewerState: 'guest' | 'owner' | 'buyable' = !user
    ? 'guest'
    : user.id === l.seller_id
      ? 'owner'
      : 'buyable'
```

4. Replace the entire `<div className="mt-6">…</div>` block (the disabled button + "coming soon" text) with:

```tsx
      <div className="mt-6">
        <BuyButton listingId={l.id} viewerState={viewerState} />
      </div>
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. (If `.next` throws a stale ENOENT, `rm -rf .next` and rebuild once.)

- [ ] **Step 4: Commit**

```bash
git add components/exchange/BuyButton.tsx "app/(public)/exchange/[id]/page.tsx"
git commit -m "feat: #13b live Buy button on listing detail"
```

---

## Task 7: Buyer "My Orders" + Seller "My Sales" dashboard panels

**Files:**
- Create: `components/dashboard/MyOrders.tsx`
- Create: `components/dashboard/MySales.tsx`
- Modify: `components/dashboard/MyListings.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Produces: `<MyOrders orders={OrderRow[]} />`, `<MySales sales={OrderRow[]} />`, shared `OrderRow = { id: string; title: string; amount: number; status: string }`.

- [ ] **Step 1: Write the MyOrders panel**

Create `components/dashboard/MyOrders.tsx`:

```tsx
import { formatNaira } from '@/lib/format'

export interface OrderRow {
  id: string
  title: string
  amount: number
  status: string
}

const BUYER_STATUS: Record<string, { label: string; cls: string }> = {
  initiated: { label: 'Awaiting payment', cls: 'text-amber-400' },
  payment_held: { label: 'Payment secured, awaiting delivery', cls: 'text-sky-400' },
  completed: { label: 'Complete — funds released to seller', cls: 'text-emerald-400' },
  refunded: { label: 'Refunded to buyer', cls: 'text-slate-400' },
}

export function MyOrders({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) return null
  return (
    <section id="orders" className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My orders</h2>
      <div className="space-y-2">
        {orders.map((o) => {
          const s = BUYER_STATUS[o.status] ?? { label: o.status, cls: 'text-slate-400' }
          return (
            <div key={o.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="truncate font-bold text-white">{o.title}</p>
              <p className="text-xs text-slate-500">
                {formatNaira(o.amount)} · <span className={s.cls}>{s.label}</span>
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Write the MySales panel**

Create `components/dashboard/MySales.tsx`:

```tsx
import { formatNaira } from '@/lib/format'
import type { OrderRow } from './MyOrders'

const SELLER_STATUS: Record<string, { label: string; cls: string }> = {
  initiated: { label: 'Buyer starting checkout', cls: 'text-amber-400' },
  payment_held: { label: 'Paid — deliver now', cls: 'text-sky-400' },
  completed: { label: 'Complete — funds released to you', cls: 'text-emerald-400' },
  refunded: { label: 'Refunded to buyer', cls: 'text-slate-400' },
}

export function MySales({ sales }: { sales: OrderRow[] }) {
  if (sales.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My sales</h2>
      <div className="space-y-2">
        {sales.map((o) => {
          const s = SELLER_STATUS[o.status] ?? { label: o.status, cls: 'text-slate-400' }
          return (
            <div key={o.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="truncate font-bold text-white">{o.title}</p>
              <p className="text-xs text-slate-500">
                {formatNaira(o.amount)} · <span className={s.cls}>{s.label}</span>
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Add the `reserved` label to MyListings**

In `components/dashboard/MyListings.tsx`, add to the `STATUS` map (after the `sold` line):

```ts
  reserved: { label: 'Reserved (in escrow)', cls: 'text-sky-400' },
```

- [ ] **Step 4: Wire the panels into the dashboard**

In `app/dashboard/page.tsx`:

1. Add imports:

```tsx
import { MyOrders, type OrderRow } from '@/components/dashboard/MyOrders'
import { MySales } from '@/components/dashboard/MySales'
```

2. Add two queries to the `Promise.all` array (after the `marketplace_listings` query):

```tsx
    supabase
      .from('marketplace_orders')
      .select('id, listing_title, amount, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_title, amount, status')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
```

   and update the destructuring to capture them:

```tsx
  const [profileRes, matchesRes, resultsRes, regsRes, wrRes, listingsRes, ordersRes, salesRes] =
    await Promise.all([
```

3. After the `myListings` mapping, map the orders:

```tsx
  const toOrderRow = (r: { id: string; listing_title: string; amount: number; status: string }): OrderRow => ({
    id: r.id,
    title: r.listing_title,
    amount: r.amount,
    status: r.status,
  })
  const myOrders: OrderRow[] = (ordersRes.data ?? []).map(toOrderRow)
  const mySales: OrderRow[] = (salesRes.data ?? []).map(toOrderRow)
```

4. Render the panels in the JSX after `<MyListings … />`:

```tsx
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/MyOrders.tsx components/dashboard/MySales.tsx components/dashboard/MyListings.tsx app/dashboard/page.tsx
git commit -m "feat: #13b My Orders + My Sales dashboard panels"
```

---

## Task 8: Full verification + push

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: all tests pass (including `lib/exchange/escrow.test.ts`).

- [ ] **Step 2: Clean typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0. If `.next` ENOENT flakiness appears, `rm -rf .next` and rebuild once.

- [ ] **Step 3: Update ROADMAP + memory**

- In `ROADMAP.md`, mark row `13b` ✅.
- Update `memory/project_current_phase.md` to note #13b complete (buyer escrow flow live; delivery/disputes handled on Zolarux; next is #14 KYC + withdrawals).

```bash
git add ROADMAP.md
git commit -m "docs: mark #13b Gaming Exchange purchase + escrow complete"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```
Expected: push succeeds. If rejected (remote ahead), `git pull --rebase origin main`, re-run `npx tsc --noEmit && npm run build`, then push.

---

## Self-Review Notes (for the implementer)

- **`return_url` assumption:** Zolarux may ignore or reject the extra field. If the initiate call starts failing with a 4xx that references `return_url`, drop it from `buildInitiatePayload` (buyer then lands on Zolarux's default post-payment page; status still arrives by webhook). Documented in the spec's Assumptions.
- **Double-buy race:** two buyers can both reach `payment_held` on one listing; Zolarux is authoritative and Rex refunds one from the panel. SentinelX reflects whatever webhooks arrive — no extra locking in this build (per spec judgment call ④).
- **No client writes to `marketplace_orders`:** the buy action inserts via the service-role client and the webhook updates via service-role; RLS exposes reads only to buyer/seller/staff.
