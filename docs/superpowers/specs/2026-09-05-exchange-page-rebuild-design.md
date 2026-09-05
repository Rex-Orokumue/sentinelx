# Gaming Exchange Page Rebuild — Design

**Date:** 2026-09-05
**Route:** `/exchange` (`app/[locale]/(public)/exchange/page.tsx`)
**Reference:** `public/visual_bible/store_page.jpeg`

## Goal

Rebuild the `/exchange` page body so it matches the visual bible mockup
`store_page.jpeg` — layout, section order, copy, and colour — while every number
on the page comes from real data.

## Scope boundary

In scope: everything between the site header and the site footer on `/exchange`.

Out of scope, deliberately:

- `SiteHeader` and `SiteFooter` stay untouched. The mockup draws its own top nav
  (with a cart icon) and a three-column footer with a "WE ACCEPT" payment row.
  Those are global components shared by every page; changing them is a separate
  decision. The rebuilt page renders inside the current header and footer.
- No marketplace trade-rating system (see "Statistics" below).
- No new listing category. The mockup's seventh tile, "Skins & Items", is dropped;
  the six existing categories are kept and relabelled.

## Design system

The mockup's palette already exists in `tailwind.config.ts` under the `sx` tokens:

| Token | Value | Use |
|---|---|---|
| `sx-bg` | `#0B0B0F` | page background |
| `sx-surface` | `#13131F` | cards, panels, sidebar |
| `sx-border` | `#1E1E30` | card borders |
| `sx-purple` | `#7C3AED` | primary CTA, active state |
| `sx-purple-light` | `#9333EA` | hover |
| `sx-purple-glow` | `rgba(124,58,237,.25)` | hero glow |

No new colours. Icons come from `lucide-react`, already a dependency.

## Page structure

Sections, top to bottom. Copy below is literal — it is what renders.

### 1. Hero — `components/exchange/ExchangeHero.tsx`

Left column:

- Eyebrow: `GAMING EXCHANGE` — purple, uppercase, letter-spaced, small.
- Headline, two lines, display font, heavy:
  - `BUY. SELL. TRADE.` — white
  - `PLAY MORE.` — purple
- Subhead, two lines:
  - `The most trusted marketplace for gamers.`
  - `Accounts, coins, gift cards & more – all in one place.`
- Trust pills, one row of four. Each is a small purple rounded-square icon plus a
  two-line label:

  | Icon | Title | Sub |
  |---|---|---|
  | `BadgeCheck` | Verified Sellers | 100% Verified |
  | `ShieldCheck` | Safe Trades | Escrow Protection |
  | `Tag` | Best Prices | Compare & Save |
  | `Headphones` | 24/7 Support | We've got you |

- Buttons: `Browse Listings` (purple, filled, `ShoppingBag` icon) anchors to the
  Featured Listings section; `Sell an Item` (dark, bordered, `Upload` icon) links
  to `/exchange/new`.

Centre-right: mascot image over a radial purple glow. Uses an existing asset from
`public/mascot/` until dedicated store artwork exists.

Far right — the "Hey Gamer" card (`sx-surface`, bordered, rounded):

- `Hey Gamer! 👋`
- Three rows with small purple icons: `Find epic deals`, `Trade safely`,
  `Level up your game`
- `All backed by ZOLARUX ESCROW protection.` — "ZOLARUX" emphasised
- Purple button `Learn More →` linking to `/escrow`

### 2. Escrow strip — `components/exchange/EscrowStrip.tsx`

One full-width rounded `sx-surface` bar, entirely static:

- Green `ShieldCheck` + `TRADE SAFE. TRADE SMART.` (bold white) above
  `All transactions are protected by Zolarux Escrow.` (muted)
- Three numbered steps in purple circles, separated by arrows:
  1. `Buyer Pays` / `Funds held securely`
  2. `You Deliver` / `Item delivered`
  3. `Buyer Confirms` / `You get paid`
- Right cap: green check circle + `100% SAFE` / `or Your Money Back`

### 3. Body — two columns

Main column ~72%, sidebar ~28%, on a 12-column grid at `lg` and above.

#### 3a. Browse Categories — `components/exchange/CategoryGrid.tsx`

Panel headed `BROWSE CATEGORIES`. Six tiles in one row, each an icon, a label and
a live count. Labels are remapped to the mockup's wording:

| Category value | Tile label | Icon |
|---|---|---|
| `account` | Game Accounts | `Gamepad2` |
| `coins` | Coins & Currency | `Coins` |
| `gift_card` | Gift Cards | `CreditCard` |
| `accessories` | Accessories | `Headphones` |
| `phone` | Gaming Phones | `Smartphone` |
| `controller` | Controllers | `Gamepad` |

Each tile links to `/exchange?category=<value>` — the filter the page already
supports. The count is the real number of `active` listings in that category,
rendered `N Listings` (`1 Listing` when singular, `No listings yet` at zero).

These labels live in a new `CATEGORY_TILE_LABELS` map. The existing
`CATEGORY_LABELS` (short forms: "Account", "Coins") is left alone — it is used by
the sell form, admin, and filter chips, where the long marketing labels would read
badly.

#### 3b. Featured Listings — `components/exchange/FeaturedListings.tsx`

Header row: orange `Flame` icon + `FEATURED LISTINGS`, muted
`Hot deals from verified sellers`, and a purple `View All Categories` link on the
right pointing at `/exchange`.

Grid of `ListingCard`s: four across at `lg`, two at mobile. Ordered badge-first
(`featured` before everything else), then newest.

#### 3c. Sidebar

**Quick Actions** — `components/exchange/QuickActionsPanel.tsx`, auth-aware.

Signed in, three rows (icon tile + title + sub):

| Icon | Title | Sub | Link |
|---|---|---|---|
| `Upload` | Sell an Item | List your item in minutes | `/exchange/new` |
| `LayoutList` | My Listings | Manage your items | `/dashboard/marketplace` |
| `Package` | My Orders | Track your orders | `/dashboard/marketplace` |

Signed out: the panel is replaced by a single sign-up card — a short
"Create an account to start trading" prompt with a purple `Create Account` button
to `/signup` and a muted `Log in` link to `/login?next=/exchange`. This is a
deliberate difference from the mockup, chosen for conversion.

**Why Gamers Trust Us** — `components/exchange/TrustPanel.tsx`, static:

| Icon (colour) | Title | Sub |
|---|---|---|
| `ShieldCheck` (green) | Zolarux Escrow | 100% Secure Transactions |
| `BadgeCheck` (purple) | Verified Sellers Only | Every seller is verified |
| `Headphones` (white) | 24/7 Customer Support | We're here anytime |
| `Shield` (blue) | Buyer Protection | Money back guarantee |

**Trending Now** — `components/exchange/TrendingNow.tsx`.

Header `TRENDING NOW` with a `View All` link. Four compact rows: square
thumbnail, title, spec line, purple price. Ranked by `view_count` descending over
`active` listings.

### 4. Join band — `components/exchange/JoinCtaBand.tsx`

Rounded `sx-surface` band. Mascot at the left edge. Centre:

- `JOIN THOUSANDS OF GAMERS TRADING EVERY DAY`
- `Save more. Play more. Level up with Sentinel X Gaming Exchange.`
- Four stats in a row, each an icon, a large value, and a label:
  `Happy Gamers`, `Successful Trades`, `Verified Sellers`, `Positive Feedback`.

Right: a bordered box — `Trade smart. Trade safe.` / `Trade only on Sentinel X.` /
purple `Get Started Now` button to `/exchange/new` (or `/signup` when signed out).

## Listing card

`components/exchange/ListingCard.tsx` is rebuilt. `ListingCardData` gains
`badge`, `subtitle`, `description`, `originalPrice`, `sellerName`, and
`sellerVerified`.

Layout: image with the badge pinned top-left; below it the title, the spec line,
a seller row (`sellerName` plus a purple `BadgeCheck` when `sellerVerified`), then
a price row — current price in purple, `originalPrice` struck through and muted
beside it when present, and a purple cart button on the right linking to the
listing.

### Badges

Admin sets the badge; it is a nullable column, not derived.

| Value | Label | Colour |
|---|---|---|
| `featured` | FEATURED | purple |
| `hot` | HOT | red |
| `top_deal` | TOP DEAL | green |
| `new` | NEW | blue |

Separately, when `original_price` is set, a **derived** discount pill renders
(`-10%`, `-8%`) computed as `round((original - price) / original * 100)`. This is
arithmetic on data the admin entered, not an editorial label, so it needs no
admin control of its own. A listing with both a badge and a discount shows the
badge top-left and the discount pill top-right.

### Spec line

`lib/exchange/subtitle.ts` resolves the line under the title, first non-empty wins:

1. `subtitle`, if the seller set one
2. the first line of `description`, trimmed and truncated to fit one line
3. `<Game> · <Category>` from `games.name` and `CATEGORY_LABELS`
4. the category label alone, when the listing has no game

The result is always a non-empty string, so cards never render a blank row.

## Schema — `supabase/migrations/077_exchange_listing_merchandising.sql`

On `marketplace_listings`:

| Column | Type | Notes |
|---|---|---|
| `subtitle` | `text` | nullable, `CHECK (char_length(subtitle) <= 60)` |
| `original_price` | `integer` | nullable, `CHECK (original_price > price)` |
| `badge` | `text` | nullable, `CHECK (badge IN ('featured','hot','top_deal','new'))` |
| `view_count` | `integer` | `NOT NULL DEFAULT 0` |

Plus:

- `CREATE INDEX ON marketplace_listings (view_count DESC) WHERE status = 'active'`
  — serves the Trending query.
- `public.increment_listing_view(p_listing_id uuid)`, `SECURITY DEFINER`,
  incrementing `view_count` for an `active` listing. Needed because RLS gives
  anonymous visitors no UPDATE path, and view counting must work signed out.
  It touches only `view_count` and returns void.

Existing RLS policies are unchanged; the new columns inherit them.

### Trending window

Trending ranks on **all-time** `view_count`. A rolling seven-day window would
need a separate `listing_views` event table, which is disproportionate for a
four-row sidebar widget. If trending later needs recency, that is its own change.

## Statistics

`lib/exchange/stats.ts` fetches the four Join-band numbers and the category counts.
Every figure is real:

| Stat | Source |
|---|---|
| Happy Gamers | count of `profiles` |
| Successful Trades | count of `marketplace_orders` where `status = 'completed'` |
| Verified Sellers | count of distinct `seller_id` on active listings whose profile has `kyc_verified` |
| Positive Feedback | `completed / (completed + refunded)` orders, as a percentage |

Two consequences, accepted deliberately:

- **Positive Feedback is a completion rate, not buyer feedback.** There is no
  marketplace rating anywhere in the schema — `opponent_ratings` is match-only.
  Completion rate is real, already recorded, and a genuine trust signal. A true
  buyer-feedback system is a separate feature.
- **Early numbers will be small.** On launch the band will read figures like
  `12 Happy Gamers` and `3 Successful Trades`, and category tiles will show
  `2 Listings` rather than the mockup's `412+`. This was chosen over inventing
  figures on a page whose subject is trust.

When the denominator is zero, Positive Feedback renders an em dash rather than
`NaN%` or a misleading `100%`.

`formatCompactCount` renders counts the way the mockup does once they are large
enough: `950` stays `950`, `1200` becomes `1.2K+`, `50000` becomes `50K+`.

## Data flow

The page stays a server component. One `createClient()` and these reads:

1. Active listings with `games(name)`, `listing_images`, and
   `profiles!seller_id(username, display_name, kyc_verified)`, honouring the
   existing `?category=` filter.
2. Category counts, grouped by category over active listings.
3. Trending: four active listings ordered by `view_count` descending.
4. The four Join-band statistics.

The listing detail page (`exchange/[id]/page.tsx`) calls `increment_listing_view`.
The increment must never block or fail the render — errors are swallowed.

## Mobile (375px first)

Same sections in the same order:

- **Hero:** headline and subhead full width; mascot smaller and centred beneath;
  trust pills in a 2x2; buttons full-width stacked; "Hey Gamer" card below.
- **Escrow strip:** heading, then the three steps stacked vertically with the
  arrows rotated down; the "100% SAFE" cap sits last.
- **Categories:** a horizontal scroll row of tiles, snapping, no wrap.
- **Listings:** two across.
- **Sidebar:** moves below the listing grid, panels full width in order Quick
  Actions, then Trust, then Trending.
- **Join band:** mascot above the headline, stats 2x2, CTA box full width.

## Testing

Pure logic, unit-tested first (vitest, TDD):

- `lib/exchange/subtitle.ts` — every branch of the cascade, plus truncation and
  whitespace-only inputs.
- `lib/exchange/badges.ts` — label and colour per badge value, discount rounding,
  no pill when `original_price` is absent or not above `price`.
- `lib/exchange/stats.ts` — `formatCompactCount` boundaries, the percentage
  formatter, and the zero-denominator case.
- `CATEGORY_TILE_LABELS` — a label exists for every value in `LISTING_CATEGORIES`,
  so adding a category can never silently render an undefined tile.

Rendering and data fetching are verified by `npm run build`, `npm run test`, and a
browse of the running page at both 375px and desktop width.

## Files

**New**

- `components/exchange/ExchangeHero.tsx`
- `components/exchange/EscrowStrip.tsx`
- `components/exchange/CategoryGrid.tsx`
- `components/exchange/FeaturedListings.tsx`
- `components/exchange/QuickActionsPanel.tsx`
- `components/exchange/TrustPanel.tsx`
- `components/exchange/TrendingNow.tsx`
- `components/exchange/JoinCtaBand.tsx`
- `lib/exchange/subtitle.ts` + test
- `lib/exchange/badges.ts` + test
- `lib/exchange/stats.ts` + test
- `supabase/migrations/077_exchange_listing_merchandising.sql`

**Changed**

- `app/[locale]/(public)/exchange/page.tsx` — composes the sections
- `components/exchange/ListingCard.tsx` — badge, spec line, seller row, was-price
- `components/exchange/ListingForm.tsx` — subtitle + optional original price
- `lib/exchange/schema.ts` — schema fields, `CATEGORY_TILE_LABELS`
- `app/[locale]/admin/exchange/page.tsx` — badge + original-price controls
- `app/[locale]/(public)/exchange/[id]/page.tsx` — view increment
- `lib/supabase/types.ts` — regenerated
