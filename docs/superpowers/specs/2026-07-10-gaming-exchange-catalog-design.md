# Gaming Exchange — Catalog (#13a) — Design Spec

**Date:** 2026-07-10
**Status:** Approved design → ready for implementation plan
**Context:** v3.0 #13 sub-project a. Catalog + moderation only; the Buy flow + Zolarux escrow are **#13b**.

---

## 1. Goal & scope

Build the Gaming Exchange **catalog**: browse/filter/detail of listings, a seller create-listing flow (multi-image, → `pending`), the seller's listings in their dashboard, and admin approve/remove moderation. **No money moves and there is zero buyer-seller contact surface anywhere** — the detail page shows a **disabled "🔒 Buy — Protected by Zolarux" (coming soon)** button and nothing else actionable. Escrow, purchase, `sold`, and delivery are #13b.

The `marketplace_listings` table and its RLS already exist and are reused as-is:
- `ml_select`: `active` is public; `pending`/`removed` visible to seller + staff.
- `ml_own_insert`: seller inserts own rows.
- `ml_update`: seller (own) or staff.
- `ml_admin_delete`: admin only.

## 2. Data model (migration `012_listing_images.sql`)

### `listing_images` table
`id uuid pk`, `listing_id uuid → marketplace_listings(id) ON DELETE CASCADE`, `image_url text`, `display_order integer default 0`, `created_at timestamptz default now()`. Index `(listing_id, display_order)`. **RLS:**
- **read** when the parent listing is visible (`EXISTS` a listing with `status='active' OR seller_id=auth.uid() OR is_staff()`);
- **insert/delete** when the caller owns the parent listing or is staff.

### Public Storage bucket `listing-images`
Public read (buyers browse). Authenticated write to a `{seller_id}/…` path; owner/staff delete. Path convention `{seller_id}/{uuid}.{ext}`, so `storage.foldername(name)[1]` = the seller id. (Adapts the match-evidence bucket pattern, but **public** rather than signed.)

### Status-guard trigger (closes seller self-approval)
`ml_update` lets a seller update their own row, which would let them set `status='active'` and bypass moderation. A `BEFORE UPDATE` trigger `enforce_listing_status()` rejects any status change by a **non-staff** user to anything other than `removed`:
```
IF NEW.status IS DISTINCT FROM OLD.status
   AND NOT public.is_staff()
   AND NEW.status <> 'removed'
THEN RAISE EXCEPTION ...
```
So a seller can only **withdraw** their own listing (`→ removed`); `active`/`sold` are staff-only. The trigger restricts *status transitions* only — 13a ships **no listing-edit UI** (a seller who wants changes removes and recreates; see §8).

After the migration, **regenerate `lib/supabase/types.ts`**.

### Category image rule
`account`, `controller`, `phone` → **≥1 image required**. `coins`, `accessories`, `gift_card` → optional (gift-card generic-image policy enforced by admin review, not code). Expressed as a pure, tested function.

## 3. Public `/exchange`

- **Browse** — `app/(public)/exchange/page.tsx`: grid of **`active`** listings, filterable by **category** (6) and **game** (reusing the `/tournaments` game-filter pattern). Each card: **primary image** (lowest `display_order`; placeholder if none), title, `formatNaira(price)`, category badge, game name. Empty state; a "Sell an item" CTA → `/exchange/new`.
- **Detail** — `app/(public)/exchange/[id]/page.tsx`: an **image gallery/carousel**, title, price, category, game, description, and the seller shown as **`@username` only — a plain text link to `/players/[username]`, with no avatar, Sentinel Score, or other profile info inline** (minimizes off-platform contact vectors). A prominent **disabled** `🔒 Buy — Protected by Zolarux` button with a "coming soon" hint. `generateMetadata` + OpenGraph (WhatsApp previews). Only `active` listings are publicly visible (own/staff may view non-active).

## 4. Seller flow

- **Create — `app/(public)/exchange/new/page.tsx`** (auth; redirect to login otherwise). A client form: title, category (select), game (optional select), description, price. **Multi-image upload with drag-to-reorder** — images upload client-side to the `listing-images` bucket under `{userId}/{uuid}`, collecting ordered public URLs. On submit, a server action `createListing({ title, category, gameId, description, price, imageUrls })` (`lib/exchange/actions.ts`): auth-guard, validate via `listingSchema` + the category image rule, insert the `marketplace_listings` row (`seller_id`, `status='pending'`), then insert `listing_images` (`display_order` = array index). Returns the new id.
- **My Listings** — a panel in `/dashboard`: the seller's listings (primary image, title, price, **status** as Pending review / Active / Removed) with a **Remove** action → `removeListing(id)` (own listing → `removed`; permitted by RLS + the trigger).

## 5. Admin moderation

`app/admin/exchange/page.tsx` (`requireStaff`): a **pending queue** — each with thumbnails + details — and **Approve** (→ `active`) / **Remove** (→ `removed`) actions, plus a recent-resolved list. Server actions in `lib/exchange/admin-actions.ts` (`requireStaff`, session client so RLS/trigger apply, `revalidatePath('/exchange')` + `/admin/exchange`). New `ADMIN_NAV` entry `{ label: 'Exchange', href: '/admin/exchange', adminOnly: false }` (editorial/moderation — moderators may manage, matching the TV precedent).

## 6. Helpers, validation, testing

`lib/exchange/` pure, unit-tested (Vitest):
- `schema.ts` — `LISTING_CATEGORIES`, `CATEGORY_LABELS`, `listingSchema` (zod: `title` non-empty, `category` enum, `price` integer **≥ ₦500** — matches the tournament entry fee and filters junk listings, optional `gameId` uuid / `description`).
- `images.ts` — `imageRequired(category): boolean` and `validateImageCount(category, count): boolean` (the §2 rule). Tested for each category + boundary.

Presentational components and pages verified by `npm run build`; the upload/admin flows are thin over these tested pures.

## 7. Wiring & SEO

- **Trade pillar tab** → in `lib/nav/tabs.ts`, change `trade` to `href: '/exchange'`, `feature: null`, `match: '/exchange'`; update `lib/nav/tabs.test.ts` (add a Trade→/exchange active test; `community` remains the coming-soon example).
- **Desktop header**: add `{ href: '/exchange', label: 'Exchange' }` to `SiteHeader`'s `NAV`.
- `/exchange` + detail: `generateMetadata` + OpenGraph.

## 8. Scope boundaries

**In:** `listing_images` + public bucket + status-guard trigger; browse/filter/detail; multi-image create + reorder; My Listings + remove; admin approve/remove; helpers + tests; Trade-tab + header wiring.
**Out (#13b / later):** the Buy flow; Zolarux escrow (`escrow_status`/`zolarux_reference`); the `sold` transition; delivery confirmation; **any buyer-seller contact / messaging**; offers/negotiation; **listing edit of any kind** (no edit UI in 13a — remove + recreate); favourites/saved; seller ratings.

**Known technical debt (call out, don't build now):** **orphaned Storage files.** `ON DELETE CASCADE` removes `listing_images` rows, but the actual files in the `listing-images` bucket are **not** deleted when a listing is removed or admin-deleted. A later housekeeping job (or a Storage-cleanup on delete) will handle this; until then, orphaned files accumulate harmlessly.
