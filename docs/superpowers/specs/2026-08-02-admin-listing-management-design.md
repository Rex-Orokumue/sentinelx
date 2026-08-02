# Admin listing management: delete, mark-as-sold, WhatsApp contact

## Problem

Admins currently have no way to permanently remove a junk/spam listing, no way to
close out a listing that sold off-platform, and no direct way to message a seller.
The admin exchange page (`app/admin/exchange/page.tsx`) only shows a pending-approval
queue and recent orders — there's no view of active/sold listings at all.

This is the first of three related-but-independent features requested together
(admin listing management, fund-wallet, buy-requests). The other two get their own
specs.

## Current state (relevant facts)

- `marketplace_listings.status` CHECK allows `pending/active/sold/removed/reserved`.
- DB trigger `enforce_listing_status()` (`012_listing_images.sql`, updated in
  `013_marketplace_orders.sql`): non-staff callers may only transition status to
  `'removed'`. Staff/`service_role` can set other values — needs verifying whether
  staff can already set `'sold'` directly or only `service_role` (the Zolarux
  webhook) can; confirm during implementation and adjust the trigger if needed.
- RLS already has an `ml_admin_delete` policy (`is_admin()`) on `marketplace_listings`
  — unused today.
- Existing admin moderation actions live in `lib/exchange/admin-actions.ts`
  (`approveListing`, `removeListingAdmin`), both `requireStaff()`-gated, both use a
  shared `setStatus()` helper and notify the seller.
- `profiles` already stores a WhatsApp number (shown on the dashboard profile editor)
  — reusable for a `wa.me` contact link, same pattern as the existing
  `buildZolaruxWhatsAppUrl` used on `AdminOrderRow`.
- Admin role gating: `requireStaff()` (admin + moderator) vs `requireAdmin()`
  (admin only) in `lib/admin/auth.ts`.

## Design

### Role gate

Both new actions are **admin-only** (`requireAdmin()`), not moderator-accessible —
permanent delete and manually recording a real sale are higher-stakes than the
existing soft-remove, which stays moderator-accessible as-is.

### Server actions — `lib/exchange/admin-actions.ts`

**`deleteListingAdmin(listingId: string)`**
1. `await requireAdmin()`
2. Fetch the listing; 404-style error if not found.
3. Check `marketplace_orders` for any row referencing `listingId`. If any exist,
   return an error ("Can't delete — this listing has order history. Remove it
   instead.") and stop — no partial action.
4. Delete the listing row (DB `ON DELETE CASCADE` already removes its
   `listing_images` rows; clean up the associated storage objects for those images
   before/after the row delete).
5. Insert a notification for the seller (reuse whatever notification helper
   `removeListingAdmin` already uses) explaining the listing was deleted by an
   admin.
6. `revalidatePath('/admin/exchange')`, `revalidatePath('/exchange')`, and the
   seller's dashboard path.

**`markListingSoldAdmin(listingId: string)`**
1. `await requireAdmin()`
2. Fetch the listing; error if not found or already `'sold'`/`'removed'`.
3. Check `marketplace_orders` for any row in an in-progress state
   (`reserved`/`payment_held`-equivalent, per whatever the actual order status enum
   is). If found, return an error ("This listing has an order in progress — let
   escrow finish or resolve the order first.") and stop.
4. Update listing status to `'sold'` (may require the trigger tweak noted above).
5. Notify the seller ("Admin marked your listing as sold").
6. `revalidatePath('/admin/exchange')`, `revalidatePath('/exchange')`.

Both actions follow the existing `setStatus`-style shape in the file (staff check →
fetch → guard → mutate → notify → revalidate) rather than introducing a new
pattern.

### Admin UI — `app/admin/exchange/page.tsx`

Add a new **"All listings"** section below the existing pending-approval queue,
listing every `marketplace_listings` row with a status filter (All / Active / Sold
/ Reserved / Removed). Each row shows the existing listing summary fields plus three
actions:

- **Delete** — button opens a confirm dialog ("This permanently deletes the
  listing. This can't be undone."); disabled with an inline reason if the listing
  has any orders.
- **Mark as sold** — button opens a confirm dialog; disabled with an inline reason
  if an order is in progress.
- **Message on WhatsApp** — link (not a form action) built from the seller's stored
  WhatsApp number via a `wa.me` URL, opened in a new tab. No message body is
  prefilled beyond a short generic greeting, matching the existing Zolarux-contact
  link's simplicity.

New row component, e.g. `components/admin/ExchangeListingRow.tsx`, following the
shape of the existing `ExchangeQueueRow.tsx`/`AdminOrderRow.tsx`.

### Notifications

Both actions notify the seller, consistent with the existing `removeListingAdmin`
behavior — no new notification mechanism, just new message copy for these two
cases.

## Out of scope

- Editing listing content as an admin.
- Bulk actions (multi-select delete/mark-sold).
- A dedicated audit-log table beyond the seller-facing notification.
- Any change to the Zolarux webhook flow itself.

## Testing

- Unit tests for `deleteListingAdmin` / `markListingSoldAdmin`: role gate, order-guard
  blocking, happy path, notification insert, revalidate calls — following the
  existing test shape for `approveListing`/`removeListingAdmin`.
- Manual check in the admin UI: delete a listing with no orders (succeeds), attempt
  to delete one with an order (blocked with message), mark-as-sold happy path and
  blocked-by-in-progress-order path, WhatsApp link opens the correct number.
