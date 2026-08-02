# Buy Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player submit a private "looking for X" request that only admin can see; admin brokers the match off-platform (WhatsApp) and moves the request through a status lifecycle that the buyer can track and cancel from their dashboard.

**Architecture:** A new `buy_requests` table (mirrors `marketplace_listings`' RLS/trigger shape: broad `USING` policies for select/update, plus a narrow status-transition trigger). Player-facing create/cancel actions in `lib/exchange/requests-actions.ts`; admin-only status-change actions in `lib/exchange/requests-admin-actions.ts`, both following the exact conventions established by the admin-listing-management feature (`lib/exchange/admin-actions.ts`, `admin-guards.ts`, `admin-whatsapp.ts`). A new admin page at `/admin/exchange/requests` (its own `ADMIN_NAV` entry, not nested under the already-dense `/admin/exchange` page). Buyer-facing: a plain server-action form at `/exchange/requests/new`, and a new `MyBuyRequests` dashboard section parallel to the existing `MyListings`.

**Tech Stack:** Next.js 14 Server Components + Server Actions, Supabase (Postgres + RLS), Vitest.

## Global Constraints

- Requests are **never publicly visible** — no player other than the buyer, and no unauthenticated visitor, can see a `buy_requests` row. Only the buyer (their own rows) and staff (all rows) can read them.
- All three admin status-change actions are **admin-only** (`requireAdmin()`), matching the admin-listing-management feature's precedent for money-adjacent actions — not moderator-accessible.
- Budget minimum is ₦100 (matches the existing ₦100 floor used for wallet withdrawal/deposit amounts elsewhere in this codebase).
- Status lifecycle: `open → in_progress → fulfilled` (happy path) or `open|in_progress → closed`. `fulfilled` and `closed` are terminal — no further transitions out of either, enforced both by a DB trigger and a pure guard function used by the UI/actions.
- The buyer may only ever move their own request from `open` to `closed` (cancel); every other transition is staff-only, enforced by a DB trigger mirroring `enforce_listing_status()` (`012_listing_images.sql`).
- No unit tests for thin server-action wrappers (`createBuyRequest`, `cancelBuyRequest`, the three admin actions) — matches this codebase's established convention. Pure guard/formula functions are unit tested.
- Reuses `LISTING_CATEGORIES`/`CATEGORY_LABELS` from `lib/exchange/schema.ts` — no separate category enum.

---

### Task 1: `buy_requests` table, RLS, status trigger, notification types

**Files:**
- Create: `supabase/migrations/045_buy_requests.sql`
- Modify: `lib/notifications/inbox.ts:3-16`
- Modify: `lib/supabase/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `public.buy_requests` table; `NotificationType` now includes `'buy_request_in_progress'`, `'buy_request_fulfilled'`, `'buy_request_closed'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/045_buy_requests.sql`:

```sql
-- 045_buy_requests.sql
-- Private, admin-brokered "looking for X" requests. Explicitly NOT a public
-- wanted board — the platform is the middleman for coordination and scam
-- prevention (see docs/superpowers/specs/2026-08-02-buy-requests-design.md).

CREATE TABLE public.buy_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id    uuid        NOT NULL REFERENCES public.profiles(id),
  title       text        NOT NULL,
  category    text        NOT NULL CHECK (category IN (
                'account', 'coins', 'accessories', 'gift_card', 'controller', 'phone'
              )),
  game_id     uuid        REFERENCES public.games(id),
  budget      integer     NOT NULL,  -- NGN, max the buyer will pay
  description text,
  status      text        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'fulfilled', 'closed')),
  admin_note  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.buy_requests (buyer_id);
CREATE INDEX ON public.buy_requests (status);

CREATE TRIGGER set_buy_requests_updated_at
  BEFORE UPDATE ON public.buy_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.buy_requests ENABLE ROW LEVEL SECURITY;

-- Private: buyer reads their own; staff reads all. No public clause, unlike
-- marketplace_listings' ml_select (which allows status='active' public read).
CREATE POLICY "br_select" ON public.buy_requests
  FOR SELECT USING (auth.uid() = buyer_id OR public.is_staff());

CREATE POLICY "br_own_insert" ON public.buy_requests
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "br_update" ON public.buy_requests
  FOR UPDATE USING (auth.uid() = buyer_id OR public.is_staff());

-- Status guard: the buyer may only cancel their own still-open request
-- (open -> closed). Every other transition is staff-only. Mirrors
-- enforce_listing_status() in 012_listing_images.sql.
CREATE OR REPLACE FUNCTION public.enforce_buy_request_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff()
     AND NOT (OLD.status = 'open' AND NEW.status = 'closed' AND auth.uid() = OLD.buyer_id) THEN
    RAISE EXCEPTION 'Only staff can set a buy request status to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_buy_request_status
  BEFORE UPDATE ON public.buy_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_buy_request_status();

-- Notification types for the three status transitions the buyer sees.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed'
  ));
```

- [ ] **Step 2: Apply the migration**

Apply it via the `mcp__claude_ai_Supabase__apply_migration` MCP tool (project id `itxubrkbropttfdackmi`, name `045_buy_requests`, body = the SQL from Step 1) — this project's Supabase CLI has a known Windows connectivity gotcha (a schannel TLS check can hang indefinitely), so the MCP tool is the reliable path; only fall back to `npx supabase db push` if the MCP tool is unavailable.

- [ ] **Step 3: Regenerate Supabase types**

Use the `mcp__claude_ai_Supabase__generate_typescript_types` MCP tool (project id `itxubrkbropttfdackmi`). Its response is a JSON object with a `types` string field containing the full file contents — write that string verbatim to `lib/supabase/types.ts` (overwrite the whole file). Confirm afterward with a quick search that the file now contains `buy_requests`.

- [ ] **Step 4: Extend the `NotificationType` union**

In `lib/notifications/inbox.ts`, change:

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
  | 'buy_request_in_progress'
  | 'buy_request_fulfilled'
  | 'buy_request_closed'
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/045_buy_requests.sql lib/notifications/inbox.ts lib/supabase/types.ts
git commit -m "feat(exchange): add buy_requests table and notification types"
```

---

### Task 2: Buy request schema

**Files:**
- Modify: `lib/exchange/schema.ts`

**Interfaces:**
- Produces: `buyRequestSchema` (zod, `{ title, category, gameId?, budget, description? }`), consumed by Task 5's create action.

- [ ] **Step 1: Add the schema**

In `lib/exchange/schema.ts`, add after the existing `listingSchema`/`ListingInput` export:

```ts
export const BUY_REQUEST_BUDGET_FLOOR_NGN = 100

export const buyRequestSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(LISTING_CATEGORIES),
  gameId: z.union([z.literal(''), z.string().uuid()]).optional(),
  budget: z.coerce
    .number()
    .int()
    .min(BUY_REQUEST_BUDGET_FLOOR_NGN, `Budget must be at least ₦${BUY_REQUEST_BUDGET_FLOOR_NGN}`),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
})

export type BuyRequestInput = z.infer<typeof buyRequestSchema>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/exchange/schema.ts
git commit -m "feat(exchange): add buy request schema"
```

---

### Task 3: Status-transition guards

**Files:**
- Create: `lib/exchange/requests-guards.ts`
- Test: `lib/exchange/requests-guards.test.ts`

**Interfaces:**
- Produces: `BuyRequestStatus = 'open' | 'in_progress' | 'fulfilled' | 'closed'`; `canAdminSetStatus(current: BuyRequestStatus, next: BuyRequestStatus): boolean`; `canBuyerCancel(current: BuyRequestStatus): boolean` — both consumed by Task 6 (admin actions) and Task 8/9 (UI button disabled states).

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/requests-guards.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canAdminSetStatus, canBuyerCancel } from './requests-guards'

describe('canAdminSetStatus', () => {
  it('allows open -> in_progress', () => {
    expect(canAdminSetStatus('open', 'in_progress')).toBe(true)
  })
  it('allows open -> fulfilled directly (admin can skip in_progress)', () => {
    expect(canAdminSetStatus('open', 'fulfilled')).toBe(true)
  })
  it('allows in_progress -> fulfilled', () => {
    expect(canAdminSetStatus('in_progress', 'fulfilled')).toBe(true)
  })
  it('allows open -> closed', () => {
    expect(canAdminSetStatus('open', 'closed')).toBe(true)
  })
  it('allows in_progress -> closed', () => {
    expect(canAdminSetStatus('in_progress', 'closed')).toBe(true)
  })
  it('rejects any transition out of a terminal fulfilled state', () => {
    expect(canAdminSetStatus('fulfilled', 'closed')).toBe(false)
    expect(canAdminSetStatus('fulfilled', 'open')).toBe(false)
  })
  it('rejects any transition out of a terminal closed state', () => {
    expect(canAdminSetStatus('closed', 'open')).toBe(false)
    expect(canAdminSetStatus('closed', 'fulfilled')).toBe(false)
  })
  it('rejects a no-op transition to the same status', () => {
    expect(canAdminSetStatus('open', 'open')).toBe(false)
  })
})

describe('canBuyerCancel', () => {
  it('allows cancelling an open request', () => {
    expect(canBuyerCancel('open')).toBe(true)
  })
  it('rejects cancelling once in_progress', () => {
    expect(canBuyerCancel('in_progress')).toBe(false)
  })
  it('rejects cancelling a terminal request', () => {
    expect(canBuyerCancel('fulfilled')).toBe(false)
    expect(canBuyerCancel('closed')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/requests-guards.test.ts`
Expected: FAIL — `Cannot find module './requests-guards'`

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/requests-guards.ts`:

```ts
// Status-transition guards for buy_requests, mirroring the shape of
// lib/exchange/admin-guards.ts. Used both to gate the admin actions
// (lib/exchange/requests-admin-actions.ts) and to disable UI buttons for
// transitions that would be rejected server-side anyway.

export type BuyRequestStatus = 'open' | 'in_progress' | 'fulfilled' | 'closed'

const TERMINAL: ReadonlySet<BuyRequestStatus> = new Set<BuyRequestStatus>(['fulfilled', 'closed'])

/** What an admin may set NEXT, given the CURRENT status. */
export function canAdminSetStatus(current: BuyRequestStatus, next: BuyRequestStatus): boolean {
  if (TERMINAL.has(current)) return false
  if (current === next) return false
  if (next === 'in_progress') return current === 'open'
  if (next === 'fulfilled') return current === 'open' || current === 'in_progress'
  if (next === 'closed') return current === 'open' || current === 'in_progress'
  return false
}

/** The buyer may only cancel (open -> closed) while still open. */
export function canBuyerCancel(current: BuyRequestStatus): boolean {
  return current === 'open'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/requests-guards.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/requests-guards.ts lib/exchange/requests-guards.test.ts
git commit -m "feat(exchange): add buy request status-transition guards"
```

---

### Task 4: Buyer WhatsApp contact link

**Files:**
- Create: `lib/exchange/requests-whatsapp.ts`
- Test: `lib/exchange/requests-whatsapp.test.ts`

**Interfaces:**
- Consumes: `parsePlayerPhone` from `lib/phone/number.ts`; `formatNaira` from `lib/format.ts`.
- Produces: `buildBuyerWhatsAppUrl(args): string | null`, consumed by Task 9's admin page query.

This duplicates the small shape of `lib/exchange/admin-whatsapp.ts`'s `buildSellerWhatsAppUrl` rather than generalizing it into a shared function — the two call sites (contacting a listing's seller vs. a buy request's buyer) are unrelated enough that a shared abstraction would just be indirection for ~10 lines of logic.

- [ ] **Step 1: Write the failing test**

Create `lib/exchange/requests-whatsapp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildBuyerWhatsAppUrl } from './requests-whatsapp'

const base = {
  buyerWhatsapp: '08012345678',
  buyerCountry: null as string | null,
  buyerName: 'Chidi',
  requestTitle: 'FC Mobile account, high rated',
  budget: 15000,
}

describe('buildBuyerWhatsAppUrl', () => {
  it('builds a wa.me link with the buyer request details', () => {
    const url = buildBuyerWhatsAppUrl(base)!
    expect(url.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toContain('Chidi')
    expect(text).toContain('FC Mobile account, high rated')
    expect(text).toContain('₦15,000')
  })

  it('parses against the buyer own country', () => {
    const url = buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: '0712345678', buyerCountry: 'Kenya' })!
    expect(url.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it('returns null when the buyer has no WhatsApp number', () => {
    expect(buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: null })).toBeNull()
  })

  it('returns null when the number is unparseable', () => {
    expect(buildBuyerWhatsAppUrl({ ...base, buyerWhatsapp: 'ask me on IG' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/exchange/requests-whatsapp.test.ts`
Expected: FAIL — `Cannot find module './requests-whatsapp'`

- [ ] **Step 3: Write the implementation**

Create `lib/exchange/requests-whatsapp.ts`:

```ts
// A one-tap "message this buyer about their request" link for the admin
// buy-requests page, mirroring lib/exchange/admin-whatsapp.ts's seller
// contact pattern.
import { parsePlayerPhone } from '@/lib/phone/number'
import { formatNaira } from '@/lib/format'

export function buildBuyerWhatsAppUrl(args: {
  buyerWhatsapp: string | null | undefined
  buyerCountry?: string | null
  buyerName: string
  requestTitle: string
  budget: number
}): string | null {
  const phone = parsePlayerPhone(args.buyerWhatsapp, { country: args.buyerCountry })
  if (!phone) return null
  const text =
    `Hi ${args.buyerName} — SentinelX admin here about your Exchange request ` +
    `"${args.requestTitle}" (budget ${formatNaira(args.budget)}).`
  return `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/exchange/requests-whatsapp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/requests-whatsapp.ts lib/exchange/requests-whatsapp.test.ts
git commit -m "feat(exchange): add buy request buyer WhatsApp contact link"
```

---

### Task 5: Player actions — create and cancel

**Files:**
- Create: `lib/exchange/requests-actions.ts`

**Interfaces:**
- Consumes: `buyRequestSchema` from `./schema` (Task 2).
- Produces: `createBuyRequest(input): Promise<{ id?: string; error?: string }>` and `cancelBuyRequest(_prev: ActionState, formData: FormData): Promise<ActionState>` where `ActionState = { error?: string; success?: boolean } | undefined`, consumed by Task 7 (`BuyRequestForm`) and Task 8 (`MyBuyRequests`).

No automated test — thin server-action wrappers, matches this codebase's convention (see Global Constraints).

- [ ] **Step 1: Write the actions**

Create `lib/exchange/requests-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buyRequestSchema } from './schema'

export type ActionState = { error?: string; success?: boolean } | undefined

export async function createBuyRequest(input: {
  title: string
  category: string
  gameId?: string
  budget: number
  description?: string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a request.' }

  const parsed = buyRequestSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const { data: request, error } = await supabase
    .from('buy_requests')
    .insert({
      buyer_id: user.id,
      title: d.title,
      category: d.category,
      game_id: d.gameId || null,
      budget: d.budget,
      description: d.description || null,
      status: 'open',
    })
    .select('id')
    .single()
  if (error || !request) return { error: 'Could not submit your request. Please try again.' }

  revalidatePath('/dashboard')
  return { id: request.id }
}

export async function cancelBuyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }
  const supabase = createClient()
  // RLS + the status trigger permit a buyer to cancel their own still-open request.
  const { error } = await supabase.from('buy_requests').update({ status: 'closed' }).eq('id', id)
  if (error) return { error: 'Could not cancel the request.' }
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/exchange/requests-actions.ts
git commit -m "feat(exchange): add createBuyRequest/cancelBuyRequest player actions"
```

---

### Task 6: Admin actions — status changes

**Files:**
- Create: `lib/exchange/requests-admin-actions.ts`

**Interfaces:**
- Consumes: `canAdminSetStatus`, `type BuyRequestStatus` from `./requests-guards` (Task 3); `requireAdmin` from `@/lib/admin/auth`; `notifyInApp` from `@/lib/notifications/inbox`.
- Produces: `markBuyRequestInProgress`, `markBuyRequestFulfilled`, `closeBuyRequest` — all `(_prev: ActionState, formData: FormData) => Promise<ActionState>`, consumed by Task 9's `BuyRequestRow`.

No automated test — thin server-action wrapper, matches this codebase's convention (the guard logic it calls is already tested in Task 3).

- [ ] **Step 1: Write the actions**

Create `lib/exchange/requests-admin-actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp, type NotificationType } from '@/lib/notifications/inbox'
import { canAdminSetStatus, type BuyRequestStatus } from './requests-guards'

export type ActionState = { error?: string; success?: boolean } | undefined

const NOTIFICATION_FOR: Partial<Record<BuyRequestStatus, NotificationType>> = {
  in_progress: 'buy_request_in_progress',
  fulfilled: 'buy_request_fulfilled',
  closed: 'buy_request_closed',
}

const TITLE_FOR: Partial<Record<BuyRequestStatus, string>> = {
  in_progress: "We're on it",
  fulfilled: 'Request fulfilled',
  closed: 'Request closed',
}

async function setStatus(id: string, next: BuyRequestStatus, note: string | null): Promise<ActionState> {
  await requireAdmin()
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const { data: request } = await supabase
    .from('buy_requests')
    .select('buyer_id, title, status')
    .eq('id', id)
    .maybeSingle()
  if (!request) return { error: 'Request not found.' }

  if (!canAdminSetStatus(request.status as BuyRequestStatus, next)) {
    return { error: `Can't move a ${request.status} request to ${next}.` }
  }

  const update: { status: BuyRequestStatus; admin_note?: string } = { status: next }
  if (note) update.admin_note = note

  const { error } = await supabase.from('buy_requests').update(update).eq('id', id)
  if (error) return { error: 'Could not update the request.' }

  const type = NOTIFICATION_FOR[next]
  if (type) {
    await notifyInApp({
      playerId: request.buyer_id,
      type,
      title: TITLE_FOR[next] ?? 'Request updated',
      body: note
        ? `Your request "${request.title}": ${note}`
        : `Your request "${request.title}" is now ${next.replace('_', ' ')}.`,
      link: '/dashboard',
    })
  }

  revalidatePath('/admin/exchange/requests')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markBuyRequestInProgress(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'in_progress', null)
}

export async function markBuyRequestFulfilled(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'fulfilled', null)
}

export async function closeBuyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const note = String(formData.get('note') ?? '').trim()
  return setStatus(String(formData.get('id') ?? ''), 'closed', note || null)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `notifyInApp`'s `NotificationType` isn't already exported as a named type from `lib/notifications/inbox.ts`, add `export` to its `type NotificationType = ...` declaration — check Task 1's edit first, since it should already be exported.)

- [ ] **Step 3: Commit**

```bash
git add lib/exchange/requests-admin-actions.ts
git commit -m "feat(exchange): add admin buy request status-change actions"
```

---

### Task 7: Buy request form + entry point on the Exchange page

**Files:**
- Create: `components/exchange/BuyRequestForm.tsx`
- Create: `app/(public)/exchange/requests/new/page.tsx`
- Modify: `app/(public)/exchange/page.tsx`

**Interfaces:**
- Consumes: `createBuyRequest` from `@/lib/exchange/requests-actions` (Task 5); `LISTING_CATEGORIES`, `CATEGORY_LABELS`, `type ListingCategory` from `@/lib/exchange/schema`.

- [ ] **Step 1: Write the form component**

Create `components/exchange/BuyRequestForm.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBuyRequest } from '@/lib/exchange/requests-actions'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export function BuyRequestForm({ games }: { games: { id: string; name: string }[] }) {
  const router = useRouter()
  const [category, setCategory] = useState<ListingCategory>('account')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await createBuyRequest({
        title: String(fd.get('title') ?? ''),
        category,
        gameId: String(fd.get('gameId') ?? '') || undefined,
        budget: Number(fd.get('budget') ?? 0),
        description: String(fd.get('description') ?? '') || undefined,
      })
      if (res.error) setError(res.error)
      else if (res.id) router.push('/dashboard')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Title" name="title" required placeholder="e.g. FC Mobile account, high rated" />
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
      <Field label="Budget (₦)" name="budget" type="number" min={100} required />
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-xs font-medium text-slate-400">Description</label>
        <textarea id="description" name="description" rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? 'Submitting…' : 'Submit request'}
      </button>
      <p className="text-[11px] text-slate-500">
        This is sent privately to a SentinelX admin, who&apos;ll reach out on WhatsApp if there&apos;s a match. It&apos;s never shown publicly.
      </p>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  min,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  min?: number
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

Create `app/(public)/exchange/requests/new/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestForm } from '@/components/exchange/BuyRequestForm'

export const metadata: Metadata = { title: 'Request an item — Gaming Exchange' }

export default async function NewBuyRequestPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/exchange/requests/new')

  const { data: games } = await supabase.from('games').select('id, name').eq('active', true).order('name')

  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-6">
      <h1 className="mb-1 text-2xl font-black text-white">Request an item</h1>
      <p className="mb-6 text-sm text-slate-400">
        Tell us what you&apos;re looking for. This goes straight to a SentinelX admin, never posted publicly.
      </p>
      <BuyRequestForm games={games ?? []} />
    </div>
  )
}
```

- [ ] **Step 3: Add the entry point on `/exchange`**

In `app/(public)/exchange/page.tsx`, change:

```tsx
        <Link href="/exchange/new" className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500">
          Sell an item
        </Link>
```

to:

```tsx
        <div className="flex shrink-0 gap-2">
          <Link href="/exchange/requests/new" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500">
            Can&apos;t find it? Request it
          </Link>
          <Link href="/exchange/new" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500">
            Sell an item
          </Link>
        </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/exchange/BuyRequestForm.tsx "app/(public)/exchange/requests/new/page.tsx" "app/(public)/exchange/page.tsx"
git commit -m "feat(exchange): add buy request form and Exchange page entry point"
```

---

### Task 8: Buyer's own requests on the dashboard

**Files:**
- Create: `components/dashboard/MyBuyRequests.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `cancelBuyRequest`, `type ActionState` from `@/lib/exchange/requests-actions` (Task 5); `canBuyerCancel` from `@/lib/exchange/requests-guards` (Task 3).

- [ ] **Step 1: Write the component**

Create `components/dashboard/MyBuyRequests.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { cancelBuyRequest, type ActionState } from '@/lib/exchange/requests-actions'
import { canBuyerCancel, type BuyRequestStatus } from '@/lib/exchange/requests-guards'
import { formatNaira } from '@/lib/format'

export interface MyBuyRequest {
  id: string
  title: string
  budget: number
  status: BuyRequestStatus
}

const STATUS: Record<BuyRequestStatus, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'text-amber-400' },
  in_progress: { label: 'In progress', cls: 'text-sky-400' },
  fulfilled: { label: 'Fulfilled', cls: 'text-emerald-400' },
  closed: { label: 'Closed', cls: 'text-slate-500' },
}

export function MyBuyRequests({ requests }: { requests: MyBuyRequest[] }) {
  if (requests.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My buy requests</h2>
      <div className="space-y-2">
        {requests.map((r) => (
          <Row key={r.id} request={r} />
        ))}
      </div>
    </section>
  )
}

function Row({ request }: { request: MyBuyRequest }) {
  const [state, action] = useFormState<ActionState, FormData>(cancelBuyRequest, undefined)
  const s = STATUS[request.status]
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{request.title}</p>
        <p className="text-xs text-slate-500">
          Up to {formatNaira(request.budget)} · <span className={s.cls}>{s.label}</span>
        </p>
      </div>
      {canBuyerCancel(request.status) && (
        <form action={action} className="shrink-0">
          <input type="hidden" name="id" value={request.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
            Cancel
          </button>
          {state?.error && <span className="ml-2 text-xs text-red-400">{state.error}</span>}
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the dashboard page**

In `app/dashboard/page.tsx`, add the import near the other dashboard-component imports:

```ts
import { MyBuyRequests, type MyBuyRequest } from '@/components/dashboard/MyBuyRequests'
```

Add a query to the `Promise.all` array — insert right after the existing `marketplace_listings` query (the one selecting `id, title, price, status` for `listingsRes`):

```ts
    supabase
      .from('buy_requests')
      .select('id, title, budget, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
```

...and add the corresponding destructured name (`buyRequestsRes`) to the `Promise.all` destructuring array in the same position.

After the existing `myListings` mapping, add:

```ts
  const myBuyRequests: MyBuyRequest[] = (buyRequestsRes.data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    budget: r.budget,
    status: r.status as MyBuyRequest['status'],
  }))
```

Then render it right after `<MyListings listings={myListings} />`:

```tsx
      <MyListings listings={myListings} />
      <MyBuyRequests requests={myBuyRequests} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/MyBuyRequests.tsx app/dashboard/page.tsx
git commit -m "feat(exchange): add My buy requests section to the dashboard"
```

---

### Task 9: Admin buy-requests page

**Files:**
- Create: `components/admin/BuyRequestRow.tsx`
- Create: `app/admin/exchange/requests/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `markBuyRequestInProgress`, `markBuyRequestFulfilled`, `closeBuyRequest`, `type ActionState` from `@/lib/exchange/requests-admin-actions` (Task 6); `canAdminSetStatus`, `type BuyRequestStatus` from `@/lib/exchange/requests-guards` (Task 3); `buildBuyerWhatsAppUrl` from `@/lib/exchange/requests-whatsapp` (Task 4); `WhatsAppChip` from `@/components/shared/WhatsAppChip`; `requireStaff` from `@/lib/admin/auth`.

- [ ] **Step 1: Write the row component**

Create `components/admin/BuyRequestRow.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import {
  markBuyRequestInProgress,
  markBuyRequestFulfilled,
  closeBuyRequest,
  type ActionState,
} from '@/lib/exchange/requests-admin-actions'
import { canAdminSetStatus, type BuyRequestStatus } from '@/lib/exchange/requests-guards'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { WhatsAppChip } from '@/components/shared/WhatsAppChip'

export interface AdminBuyRequest {
  id: string
  title: string
  budget: number
  category: ListingCategory
  status: BuyRequestStatus
  buyerName: string
  whatsappUrl: string | null
}

const STATUS_CLS: Record<BuyRequestStatus, string> = {
  open: 'text-amber-400',
  in_progress: 'text-sky-400',
  fulfilled: 'text-emerald-400',
  closed: 'text-slate-500',
}

export function BuyRequestRow({ request }: { request: AdminBuyRequest }) {
  const [inProgressState, inProgress] = useFormState<ActionState, FormData>(markBuyRequestInProgress, undefined)
  const [fulfilledState, fulfilled] = useFormState<ActionState, FormData>(markBuyRequestFulfilled, undefined)
  const [closeState, close] = useFormState<ActionState, FormData>(closeBuyRequest, undefined)
  const [note, setNote] = useState('')
  const err = inProgressState?.error || fulfilledState?.error || closeState?.error

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{request.title}</p>
        <p className="text-xs text-slate-500">
          {CATEGORY_LABELS[request.category]} · Up to {formatNaira(request.budget)} ·{' '}
          <span className={STATUS_CLS[request.status]}>{request.status}</span> · @{request.buyerName}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canAdminSetStatus(request.status, 'in_progress') && (
          <form action={inProgress}>
            <input type="hidden" name="id" value={request.id} />
            <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500">
              Mark in-progress
            </button>
          </form>
        )}
        {canAdminSetStatus(request.status, 'fulfilled') && (
          <form action={fulfilled}>
            <input type="hidden" name="id" value={request.id} />
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Mark fulfilled
            </button>
          </form>
        )}
        {canAdminSetStatus(request.status, 'closed') && (
          <form action={close} className="flex items-center gap-2">
            <input type="hidden" name="id" value={request.id} />
            <input
              type="text"
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
            <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500">
              Close
            </button>
          </form>
        )}
        <WhatsAppChip name={`Message @${request.buyerName}`} url={request.whatsappUrl} />
      </div>

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Write the admin page**

Create `app/admin/exchange/requests/page.tsx`:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestRow, type AdminBuyRequest } from '@/components/admin/BuyRequestRow'
import { buildBuyerWhatsAppUrl } from '@/lib/exchange/requests-whatsapp'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ListingCategory } from '@/lib/exchange/schema'
import type { BuyRequestStatus } from '@/lib/exchange/requests-guards'

export const metadata: Metadata = { title: 'Buy requests · Admin · SentinelX' }

const REQUESTS_PAGE_SIZE = 100

type BuyerRef = { username: string | null; whatsapp_number: string | null; country: string | null } | null

type Row = {
  id: string
  title: string
  budget: number
  category: ListingCategory
  status: BuyRequestStatus
  buyer: BuyerRef | BuyerRef[]
}

export default async function AdminBuyRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  await requireStaff()
  const supabase = createClient()

  const VALID_STATUSES = ['open', 'in_progress', 'fulfilled', 'closed'] as const
  const statusFilter = VALID_STATUSES.includes(searchParams.status as (typeof VALID_STATUSES)[number])
    ? searchParams.status
    : undefined

  let q = supabase
    .from('buy_requests')
    .select(
      'id, title, budget, category, status, ' +
        'buyer:profiles!buy_requests_buyer_id_fkey(username, whatsapp_number, country)',
    )
    .order('created_at', { ascending: false })
    .limit(REQUESTS_PAGE_SIZE)
  if (statusFilter) q = q.eq('status', statusFilter)

  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  const requests: AdminBuyRequest[] = rows.map((r) => {
    const buyer = Array.isArray(r.buyer) ? r.buyer[0] ?? null : r.buyer
    return {
      id: r.id,
      title: r.title,
      budget: r.budget,
      category: r.category,
      status: r.status,
      buyerName: buyer?.username ?? 'buyer',
      whatsappUrl: buildBuyerWhatsAppUrl({
        buyerWhatsapp: buyer?.whatsapp_number ?? null,
        buyerCountry: buyer?.country ?? null,
        buyerName: buyer?.username ?? 'buyer',
        requestTitle: r.title,
        budget: r.budget,
      }),
    }
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Buy requests</h1>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['all', ...VALID_STATUSES] as const).map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/exchange/requests' : `/admin/exchange/requests?status=${s}`}
            className={`rounded-full border px-3 py-1 font-bold ${
              (s === 'all' && !statusFilter) || s === statusFilter
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-slate-800 text-slate-400 hover:border-slate-600'
            }`}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1).replace('_', ' ')}
          </Link>
        ))}
      </div>
      {requests.length === 0 ? (
        <EmptyState icon="🔎" title="No requests" body="No buy requests match this filter." />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <BuyRequestRow key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the `ADMIN_NAV` entry**

In `lib/admin/nav.ts`, change:

```ts
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Wallet', href: '/admin/wallet', adminOnly: true },
```

to:

```ts
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Buy requests', href: '/admin/exchange/requests', adminOnly: true },
  { label: 'Wallet', href: '/admin/wallet', adminOnly: true },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If the `profiles` foreign-key constraint name for `buy_requests.buyer_id` isn't literally `buy_requests_buyer_id_fkey`, adjust the embed hint in the query to match — Postgres auto-generates FK constraint names as `<table>_<column>_fkey`, which is the convention every other join in this codebase relies on, e.g. `marketplace_listings_seller_id_fkey`.)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including `lib/admin/nav.test.ts` (uses its own local fixture array, unaffected by the `ADMIN_NAV` change) and every test added in Tasks 3–4.

- [ ] **Step 6: Commit**

```bash
git add components/admin/BuyRequestRow.tsx "app/admin/exchange/requests/page.tsx" lib/admin/nav.ts
git commit -m "feat(exchange): add admin buy requests page"
```

---

### Task 10: Full suite, build, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing + this plan's new tests from Tasks 3–4).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 3: Read-only DB sanity check**

Using the Supabase MCP `execute_sql` tool (read-only) against project id `itxubrkbropttfdackmi`: confirm `player_notifications_type_check` includes the three new `buy_request_*` values, and `select count(*) from public.buy_requests;` succeeds.

- [ ] **Step 4: Manual verification — submission and privacy**

Log in as a non-admin test player, submit a request via `/exchange/requests/new`, confirm it lands in their dashboard's "My buy requests" section with status "Open." Log in as a *different* non-admin player and confirm the request is nowhere visible to them (not on `/exchange`, not anywhere else). Confirm an unauthenticated visitor is redirected to log in when visiting `/exchange/requests/new`.

- [ ] **Step 5: Manual verification — admin lifecycle**

Log in as admin, open `/admin/exchange/requests` (confirm it's reachable from the admin nav), find the test request, walk it through Mark in-progress → Mark fulfilled, confirming at each step: the status-appropriate buttons update, the WhatsApp chip opens the buyer's number correctly (or shows "no WhatsApp" if they have none on file), and the buyer's dashboard status + in-app notification update to match.

- [ ] **Step 6: Manual verification — cancel and close**

Submit a second test request, cancel it as the buyer while still "Open" and confirm it disappears from the cancellable state (shows "Closed", no Cancel button). Submit a third, and as admin use Close with a note, then confirm the buyer's notification includes that note.

No commit for this task — it's verification of Tasks 1–9's already-committed work.
