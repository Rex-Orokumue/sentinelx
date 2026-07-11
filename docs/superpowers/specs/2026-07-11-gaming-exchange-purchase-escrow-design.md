# #13b — Gaming Exchange purchase + Zolarux escrow (buyer flow)

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** #13a (Gaming Exchange catalog), existing Termii notification helper (#12)

## Summary

Activate the "Buy" path on the Gaming Exchange. SentinelX hands a purchase off to
Zolarux's escrow, then reflects the escrow lifecycle back to the buyer and seller.

**Zolarux owns everything hard** — payment collection (Paystack via a Zolarux-hosted
payment link), fund custody, delivery handoff, buyer confirmation, disputes, and the
final Release / Refund decision (Rex acts from the Zolarux admin panel). SentinelX
builds **no** delivery, confirmation, dispute, or admin release/refund UI.

SentinelX's job is only:
1. **Initiate** an escrow order and redirect the buyer to Zolarux to pay.
2. **Reflect** three inbound webhook states to buyer & seller.
3. **Surface** orders (My Orders for buyers, My Sales for sellers).

## Zolarux integration contract (provided by Rex)

- **Base URL:** `https://zolarux.com.ng`
- **Auth (both directions):** `Authorization: Bearer <SENTINELX_API_SECRET>`.
  SentinelX sends it on the initiate call; Zolarux sends it on every webhook, and
  SentinelX must verify it on receipt.
- **Initiate endpoint:** `POST https://zolarux.com.ng/api/sentinelx/escrow/initiate`
  (configured via `ZOLARUX_INITIATE_URL`).
  - Send: `{ buyer_id, seller_id, listing_id, listing_title, amount, return_url }`
    — `amount` in **kobo**; `return_url` added so the buyer lands back on SentinelX
    after paying (see Assumptions).
  - Receive: `{ order_id, order_ref, payment_link }`. Redirect the buyer to
    `payment_link`.
- **Inbound webhooks:** `POST https://sentinelxesports.vercel.app/api/zolarux/webhook`,
  body `{ event, order_id, order_ref, listing_id }`:
  - `payment_held` — buyer has paid; funds held in escrow.
  - `delivery_confirmed` — Rex released funds to the seller.
  - `order_refunded` — Rex refunded the buyer.
- **Env vars** (already in `.env.local`): `SENTINELX_API_SECRET`,
  `ZOLARUX_INITIATE_URL=https://zolarux.com.ng/api/sentinelx/escrow/initiate`.
- Zolarux has already run its own `sentinelx_orders` migration on their side.

## Data model

### New table: `marketplace_orders`

A thin SentinelX-local mirror so buyer/seller pages render without calling Zolarux.
Zolarux's `sentinelx_orders` remains the source of truth for funds.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `listing_id` | uuid | FK → `marketplace_listings(id)` |
| `buyer_id` | uuid | FK → `profiles(id)` (snapshot) |
| `seller_id` | uuid | FK → `profiles(id)` (snapshot) |
| `zolarux_order_id` | text | from initiate response |
| `zolarux_order_ref` | text | from initiate response; **UNIQUE** (webhook lookup key) |
| `amount` | numeric | NGN, snapshotted server-side from `listing.price` |
| `listing_title` | text | snapshot (listing may relist/change later) |
| `status` | text | `initiated` \| `payment_held` \| `completed` \| `refunded`; CHECK-constrained; default `initiated` |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()`; bumped on webhook transition |

**Status mapping (webhook → order.status):**
`initiated` (set locally on initiate) → `payment_held` → `completed` (from
`delivery_confirmed`) / `refunded` (from `order_refunded`).

**RLS:**
- `select`: row visible only where `auth.uid() = buyer_id OR auth.uid() = seller_id`,
  plus staff (admin/moderator) may read all.
- No client `insert`/`update`/`delete` policies. Inserts happen inside the buy server
  action (runs as the authenticated buyer, guarded in code); webhook updates use the
  service-role client which bypasses RLS.

### Change: `marketplace_listings`

- **Add `reserved`** to the `status` CHECK set (was `pending | active | sold |
  removed`) and update the `enforce_listing_status` trigger to permit it. The public
  catalog / browse query continues to show only `active`.
- **Drop** the two unused placeholder columns `escrow_status` and `zolarux_reference`
  — real escrow state now lives in `marketplace_orders`, and dead columns invite
  confusion (judgment call ③, approved).

**Listing lifecycle driven by webhooks:**
- `payment_held` → listing `reserved` (removed from market; delivery in progress).
- `delivery_confirmed` → listing `sold`.
- `order_refunded` → listing back to `active` (sale fell through → relisted).

**Lock timing (judgment call ④, approved):** the listing locks at `payment_held`,
**not** at `initiated`. An abandoned checkout (buyer clicks Buy but never pays) must
not freeze a listing — important for a new marketplace with thin inventory. Trade-off:
two buyers could both pay into escrow on one listing; Zolarux is authoritative there
and Rex refunds one from the panel — SentinelX just reflects whatever webhooks arrive.

## Components

### Buy action — `lib/exchange/purchase.ts`

Server action `initiateEscrowPurchase(listingId): Promise<{ paymentLink } | { error }>`:

1. Require authenticated user (the buyer).
2. Load listing; assert `status = 'active'`; assert `buyer.id !== listing.seller_id`.
3. Compute amount server-side from `listing.price` (NGN) → `amount_kobo =
   Math.round(price * 100)`. **Never trust a client-supplied amount.**
4. `POST ZOLARUX_INITIATE_URL` with `Authorization: Bearer SENTINELX_API_SECRET`,
   body `{ buyer_id, seller_id, listing_id, listing_title, amount: amount_kobo,
   return_url: 'https://sentinelxesports.vercel.app/dashboard?tab=orders' }`.
5. On success: insert a `marketplace_orders` row (`status='initiated'`, store
   `order_id` + `order_ref` + amount + title), return `payment_link`.
6. The `BuyButton` client component redirects the browser to `payment_link`.
7. Missing env or Zolarux error → return `{ error: 'Secure checkout is temporarily
   unavailable.' }` (graceful, no crash — mirrors the ready-to-activate pattern).

### Webhook — `app/api/zolarux/webhook/route.ts`

`POST` handler (Node runtime, service-role Supabase client):

1. **Verify** the `Authorization: Bearer` header against `SENTINELX_API_SECRET` with a
   constant-time comparison → `401` on mismatch. `500` if the secret is unset.
2. Parse `{ event, order_id, order_ref, listing_id }`. Reject unknown `event` values.
3. Look up the order by `zolarux_order_ref`. Not found → `404` (logged).
4. **Idempotent:** if the order is already in the target state, return `200`
   immediately (Zolarux may retry).
5. Apply the transition atomically — update `marketplace_orders.status` +
   `updated_at`, and the listing status per the lifecycle table above.
6. **Best-effort WhatsApp notification** (judgment call ⑤, approved) via the existing
   ready-to-activate Termii helper — never throws, no-ops silently without a Termii
   key:
   - `payment_held` → seller: "You've got a sale, deliver now."
   - `completed` → buyer: funds released / order complete.
   - `order_refunded` → buyer: refunded.
7. Return `200`.

### UI surfaces

- **Listing detail (`app/(public)/exchange/[id]/page.tsx`)** — replace the disabled
  button with a live `BuyButton` client component. States:
  - logged-out → "Log in to buy" (link to `/login?next=/exchange/[id]`)
  - own listing (`viewer === seller`) → no buy button
  - listing `reserved` or `sold` → disabled "No longer available"
  - otherwise → "🔒 Buy — Protected by Zolarux" → calls action → redirects to Zolarux.
- **Buyer "My Orders"** — a dashboard panel (mirrors the existing My Listings panel),
  reachable at `/dashboard?tab=orders`. Status badges:
  - `initiated` → "Awaiting payment"
  - `payment_held` → "Payment secured, awaiting delivery"
  - `completed` → "Complete — funds released to seller"
  - `refunded` → "Refunded to buyer"
- **Seller "My Sales"** — orders where `seller_id = viewer`, same badge set, shown
  alongside My Listings in the dashboard.
- **After payment:** `return_url` brings the buyer back to `/dashboard?tab=orders`,
  where they watch status update as webhooks arrive. No dedicated return route.

## Security

- Webhook Bearer verified with constant-time compare; handler uses the service-role
  client only after verification.
- Purchase amount is authoritative server-side (from `listing.price`), never from the
  client.
- Buy guards: authenticated buyer, `buyer ≠ seller`, listing must be `active`.
- Idempotent webhook (dedupe by current state) tolerates Zolarux retries.
- No Zolarux/Termii secrets ever reach the client.
- `marketplace_orders` RLS scopes reads to the buyer, the seller, or staff.
- Zero buyer↔seller contact surface on SentinelX (carried from #13a).

## Assumptions

- **`return_url` support:** the initiate payload includes `return_url`. This could not
  be verified against Zolarux's live endpoint from the codebase; a lenient API ignores
  unknown fields, and Rex owns the endpoint and will wire it through. If Zolarux
  strictly rejects unknown fields, drop the field (buyer would then land on Zolarux's
  default post-payment page — non-blocking, status still arrives by webhook).
- Zolarux redirects the buyer to `return_url` after Paystack settlement; SentinelX
  does not receive a synchronous payment result — all state arrives via webhook.

## Out of scope (keeping #13b tight)

- No delivery UI, no buyer confirmation UI, no dispute UI (all on Zolarux).
- No admin Release/Refund controls on SentinelX (Rex acts on the Zolarux panel).
- No wallet/ledger on SentinelX.
- No order cancellation flow.

## Testing

- Unit: `initiateEscrowPurchase` guards (unauth, self-purchase, non-active listing,
  amount = price×100 in kobo, error-path returns friendly message).
- Unit: webhook handler — bad/absent Bearer → 401; unknown order_ref → 404; each
  event applies the correct order + listing transition; repeat event is idempotent.
- Migration verified against the live schema (status CHECK includes `reserved`;
  legacy columns dropped; `marketplace_orders` RLS enforced) via rolled-back SQL.
- `npx tsc --noEmit` + `npm run build` clean before push.
