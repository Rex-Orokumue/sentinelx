# Admin cancel stuck order — design

Date: 2026-08-04

## Problem

`ExchangeListingRow` disables "Delete" for any listing that has order history at all, and disables
"Mark as sold" for any listing with an order still `initiated` or `payment_held`
(`lib/exchange/admin-guards.ts`), regardless of the listing's own `status`. Order status only ever
advances via the Zolarux webhook (`app/api/zolarux/webhook/route.ts`) firing `payment_held` →
`completed`/`refunded`. If a buyer abandons checkout — or Zolarux otherwise never calls back — the
order sits at `initiated`/`payment_held` forever, permanently blocking the listing. There is
currently no admin-facing way to resolve this. Found via 4 real stuck orders across 3 listings
(some going back to 2026-07-29), all still `active`/`reserved` but with Delete/Mark-as-sold
disabled.

## Approach

Reuse the exact transition the real webhook already applies for a refund
(`transitionForEvent('order_refunded')` in `lib/exchange/escrow.ts` → `{ orderStatus: 'refunded',
listingStatus: 'active' }`), just triggered by an admin instead of a Zolarux callback. No new order
status, no new listing status — this is "apply the refund transition manually," not a new state
machine.

## Server action

New `cancelOrderAdmin(_prev, formData)` in `lib/exchange/admin-actions.ts`:

1. `requireAdmin()` — matches `deleteListingAdmin`/`markListingSoldAdmin`, both already admin-only
   (this reverses a listing's escrow-driven status, same weight as those).
2. Load the order (id, listing_id, buyer_id, status, listing_title, zolarux_order_ref).
3. 404 if not found. Error if already `completed` or `refunded` (idempotent no-op guard, mirrors
   the webhook's own `if (order.status === transition.orderStatus) return` idempotency check).
4. Update `marketplace_orders.status = 'refunded'` and `marketplace_listings.status = 'active'`, via
   `createAdminClient()` — **not** the regular staff-scoped `createClient()` the rest of this file
   uses. `marketplace_orders` has no staff UPDATE policy at all (migration 013's comment: *"No
   INSERT/UPDATE/DELETE policies: writes happen only via the service-role client (buy action insert
   + webhook updates)"*) — this action is deliberately a third write path onto that same
   service-role-only surface.
5. `notify({ playerId: order.buyer_id, type: 'escrow_refunded', title: order.listing_title,
   dedupeKey: `escrow:${order.zolarux_order_ref}:order_refunded` })` — the identical call shape the
   webhook already makes for this event, including the same dedupe key format, so a real webhook
   arriving later for the same ref naturally no-ops instead of double-notifying the buyer. No
   `notifyInApp` — that would need a new `player_notifications_type_check` migration entry that
   doesn't exist yet; out of scope for this fix.
6. `revalidatePath('/exchange')`, `revalidatePath('/admin/exchange')`, `revalidatePath('/dashboard')`
   — the same three paths `deleteListingAdmin`/`markListingSoldAdmin` already revalidate.

## UI

One new button on `AdminOrderRow` (`components/admin/AdminOrderRow.tsx`), "Cancel order," shown only
when `order.status` is `initiated` or `payment_held` — hidden once an order reaches a terminal
state. `window.confirm` guard before submit, matching the existing delete/mark-sold pattern in
`ExchangeListingRow`.

## Out of scope

- No new order/listing status values.
- No in-app notification (would need a migration; WhatsApp via `notify()` covers the agreed
  "notify the buyer" requirement).
- No audit-note field — the existing "Notify Zolarux" WhatsApp button is presumed to be how admin
  coordinates before cancelling; no new DB column for this.
- No automated/scheduled cleanup of stuck orders — this stays an explicit admin action, consistent
  with this codebase's existing rule that automation may only flag/surface, never auto-resolve.

## Files touched

- `lib/exchange/admin-actions.ts` — add `cancelOrderAdmin`
- `components/admin/AdminOrderRow.tsx` — add the Cancel order button + form
