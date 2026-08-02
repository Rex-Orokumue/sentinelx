# Buy requests (admin-brokered)

## Problem

A player looking for a specific item (e.g. "a cheap FC Mobile account") has no way
to signal that on the Exchange — they can only browse what's already listed. This is
the third of three related-but-independent features requested together (admin
listing management — shipped; wallet funding — shipped; buy requests — this spec).

## Explicit product decision: admin-brokered, not a public "wanted" board

The obvious design (a public list of "wanted" posts sellers browse and respond to
directly) was explicitly rejected in favor of routing every request through admin:
"requests should come to admin... the platform must be the middleman for proper
coordination and to avoid scam." This mirrors the trust model the rest of the
Exchange already uses — Zolarux escrow, admin-moderated listings, admin-brokered
order disputes — rather than opening a new unmoderated buyer↔seller contact surface.

## Current state (relevant facts)

- `lib/exchange/schema.ts`: `LISTING_CATEGORIES` (`account/coins/accessories/
  gift_card/controller/phone`), `CATEGORY_LABELS`, `PRICE_FLOOR_NGN = 500`. Buy
  requests reuse the same category enum.
- `lib/exchange/actions.ts`'s `createListing`/`removeListing` and
  `components/exchange/ListingForm.tsx`/`components/dashboard/MyListings.tsx` are
  the closest existing pattern for "player submits + player's own dashboard list
  with a cancel/remove action" — buy requests are simpler (no image upload), so the
  form should be a plain `useFormState` server-action form (like
  `WalletPanel.tsx`'s withdrawal form), not `ListingForm.tsx`'s client-upload
  pattern.
- Admin action conventions established in the admin-listing-management feature
  (`lib/exchange/admin-actions.ts`, `lib/exchange/admin-guards.ts`,
  `lib/exchange/admin-whatsapp.ts`, `components/admin/ExchangeListingRow.tsx`,
  `components/shared/WhatsAppChip.tsx`) are the direct template for this feature's
  admin queue and buyer-contact link.
- `lib/admin/auth.ts`: `requireAdmin()` vs `requireStaff()`.
- `lib/notifications/inbox.ts`: `notifyInApp({ playerId, type, title, body, link })`
  — `NotificationType` union needs new values for this feature (with a matching
  migration extending `player_notifications_type_check`, per the established
  drop-and-recreate convention).

## Design

### New table `buy_requests`

```sql
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
```

RLS, mirroring `marketplace_listings`' shape:
- `br_select`: buyer reads their own; staff reads all. (Not public — no `status =
  'active'`-style public-read clause, unlike listings.)
- `br_own_insert`: buyer inserts their own (`buyer_id = auth.uid()`).
- `br_update`: buyer or staff can update — but a status-guard trigger (mirroring
  `enforce_listing_status()`) restricts a non-staff update to only
  `status = 'closed'` on their own still-`open` row (buyer cancelling), never
  `in_progress`/`fulfilled`, which only staff can set.

### Buyer-facing

- `/exchange` gets a second entry point next to "Sell an item": **"Can't find it?
  Request it"**, linking to `/exchange/requests/new`.
- `/exchange/requests/new`: `BuyRequestForm` — plain server-action form (title,
  category select, optional game select, budget, description), submitting to
  `createBuyRequest`. No image upload. On success, redirect to `/dashboard` (there's
  no per-request detail page — the dashboard list *is* the detail view).
- Dashboard gets a new `MyBuyRequests` component (parallel to `MyListings`),
  listing the buyer's own requests with status and a **Cancel** button while
  `status === 'open'`, calling `cancelBuyRequest`.

### Admin-facing

- New page `app/admin/exchange/requests/page.tsx` (kept off the already-dense
  `/admin/exchange` page; linked from it via a small nav link), listing all
  `buy_requests`, filterable by status (open/in_progress/fulfilled/closed) — same
  filter-tab UX as the admin listing-management feature's "All listings" table.
- Row actions (`components/admin/BuyRequestRow.tsx`), each `requireAdmin()`-gated:
  - **Mark in-progress** (`open → in_progress`)
  - **Mark fulfilled** (`in_progress → fulfilled`, or directly from `open`)
  - **Close** (any non-terminal status → `closed`), with an optional note
  - **Message buyer on WhatsApp** — reuses `buildSellerWhatsAppUrl`-shaped logic
    from `lib/exchange/admin-whatsapp.ts` (generalized or duplicated as a small
    sibling helper — implementation detail for the plan) against the buyer's own
    `whatsapp_number`/`country`.
- Every status change notifies the buyer (`notifyInApp`, new types
  `buy_request_in_progress` / `buy_request_fulfilled` / `buy_request_closed`) —
  migration extends `player_notifications_type_check` accordingly.

### Status lifecycle

`open → in_progress → fulfilled` (happy path) or `open|in_progress → closed`
(no match found, spam, or buyer-cancelled). No transition out of `fulfilled` or
`closed` — terminal states, matching how `marketplace_listings.sold`/`removed`
already behave as end states in this codebase.

## Out of scope

- Any public/seller-facing visibility of requests.
- Seller-submitted offers, matching, or linking a request to a specific listing.
- Expiry/auto-close of stale requests.
- Images on a request.
- A per-request detail page — the dashboard list is the only buyer-facing view.

## Testing

- Unit tests for any pure helper extracted for the WhatsApp-buyer link (mirroring
  `lib/exchange/admin-whatsapp.test.ts`'s shape) and for the status-transition guard
  logic (mirroring `lib/exchange/admin-guards.test.ts`'s shape — e.g. "can admin
  move this status to X").
- No unit tests for the thin server actions themselves (`createBuyRequest`,
  `cancelBuyRequest`, the admin status-change actions) — matches this codebase's
  established convention.
- Manual check: submit a request as a player, confirm it does *not* appear anywhere
  public (`/exchange` browse or any other player's view), confirm it appears in the
  admin queue and the buyer's own dashboard, walk it through
  open → in_progress → fulfilled confirming the buyer's dashboard status and
  notifications update at each step, and confirm the buyer can cancel a still-open
  request.
