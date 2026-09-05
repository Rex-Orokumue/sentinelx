# Gaming Exchange Page Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/exchange` page body to match `public/visual_bible/store_page.jpeg`,
with every number on the page backed by real data.

**Architecture:** The page stays a Next.js server component that composes eight
presentational section components. All display logic that can be wrong — the spec-line
cascade, badge mapping, discount maths, stat formatting — lives in pure functions under
`lib/exchange/` and is unit-tested first. Data access is four Supabase reads issued from
the page. Four new columns on `marketplace_listings` carry the merchandising fields the
mockup shows.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (`sx` design tokens),
`lucide-react`, Supabase (server client), vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-exchange-page-rebuild-design.md`

**Note on code blocks:** Tasks 1–4 carry full test and implementation code, because that
logic is precise and easy to get subtly wrong. Presentational tasks (5–13) specify exact
copy, props interfaces, structure, design tokens and responsive behaviour rather than
verbatim JSX — the reference image plus the spec is the source of truth for pixel layout,
and duplicating full markup here would go stale against it.

## Global Constraints

- Mobile-first. Design at 375px, scale up. Users are phone gamers.
- Server Components by default; `"use client"` only where interactivity demands it.
- Colours come from the `sx` Tailwind tokens only: `sx-bg #0B0B0F`, `sx-surface #13131F`,
  `sx-border #1E1E30`, `sx-purple #7C3AED`, `sx-purple-light #9333EA`,
  `sx-purple-glow rgba(124,58,237,.25)`. No new colours.
- Icons from `lucide-react` (already a dependency). No new icon packages.
- Money renders through `formatNaira` from `lib/format.ts`. Never hand-format naira.
- Every stat is real. No invented figures anywhere on the page.
- `SiteHeader` and `SiteFooter` are out of scope and must not be modified.
- Existing `CATEGORY_LABELS` must not be repurposed — the new tile labels are a separate map.
- A linked worktree exists at `.claude/worktrees/i18n-static-pages-translation`. Running
  `npm run test` from the repo root double-counts tests. Scope test runs to a path
  (`npx vitest run lib/exchange`) and do not trust root totals.
- Every commit ends with the Co-Authored-By and Claude-Session trailers used on this branch.

---

### Task 1: Migration and schema constants

**Files:**
- Create: `supabase/migrations/077_exchange_listing_merchandising.sql`
- Modify: `lib/exchange/schema.ts`
- Test: `lib/exchange/schema.test.ts` — **already exists** with four `listingSchema`
  cases. Append the new `describe` blocks below; do not overwrite the file.

**Interfaces:**
- Produces: `LISTING_BADGES` (readonly tuple), `ListingBadge` type,
  `CATEGORY_TILE_LABELS: Record<ListingCategory, string>`, and `listingSchema`
  extended with optional `subtitle` and `originalPrice`.

- [ ] **Step 1: Write the migration**

```sql
-- 077_exchange_listing_merchandising.sql
-- Merchandising fields for the rebuilt /exchange page: a short spec line, a
-- was-price for discount display, an admin-set promo badge, and a view counter
-- that ranks the Trending Now sidebar.

ALTER TABLE public.marketplace_listings
  ADD COLUMN subtitle       text,
  ADD COLUMN original_price integer,
  ADD COLUMN badge          text,
  ADD COLUMN view_count     integer NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_subtitle_len
    CHECK (subtitle IS NULL OR char_length(subtitle) <= 60),
  ADD CONSTRAINT marketplace_listings_original_price_above_price
    CHECK (original_price IS NULL OR original_price > price),
  ADD CONSTRAINT marketplace_listings_badge_check
    CHECK (badge IS NULL OR badge IN ('featured', 'hot', 'top_deal', 'new'));

-- Serves the Trending Now query (active listings, most-viewed first).
CREATE INDEX marketplace_listings_view_count_idx
  ON public.marketplace_listings (view_count DESC)
  WHERE status = 'active';

-- View counting must work for signed-out visitors, who have no UPDATE path
-- under RLS. SECURITY DEFINER narrows that to exactly one column on exactly
-- one row of an active listing.
CREATE OR REPLACE FUNCTION public.increment_listing_view(p_listing_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketplace_listings
     SET view_count = view_count + 1
   WHERE id = p_listing_id
     AND status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.increment_listing_view(uuid) TO anon, authenticated;
```

- [ ] **Step 2: Write the failing schema test**

Widen the existing import line to pull in the new exports, then append:

```ts
// lib/exchange/schema.test.ts — appended to the existing suite.
// Existing import becomes:
//   import { LISTING_CATEGORIES, CATEGORY_TILE_LABELS, LISTING_BADGES, listingSchema } from './schema'

describe('CATEGORY_TILE_LABELS', () => {
  it('has a tile label for every category, so no tile renders undefined', () => {
    for (const c of LISTING_CATEGORIES) {
      expect(CATEGORY_TILE_LABELS[c]).toBeTruthy()
    }
  })

  it('uses the mockup wording', () => {
    expect(CATEGORY_TILE_LABELS.account).toBe('Game Accounts')
    expect(CATEGORY_TILE_LABELS.coins).toBe('Coins & Currency')
    expect(CATEGORY_TILE_LABELS.gift_card).toBe('Gift Cards')
    expect(CATEGORY_TILE_LABELS.phone).toBe('Gaming Phones')
  })
})

describe('LISTING_BADGES', () => {
  it('matches the badge values the database CHECK allows', () => {
    expect([...LISTING_BADGES]).toEqual(['featured', 'hot', 'top_deal', 'new'])
  })
})

describe('listingSchema merchandising fields', () => {
  const base = { title: 'DLS 24 Account', category: 'account', price: 2500 }

  it('accepts a listing with no subtitle or original price', () => {
    expect(listingSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a subtitle at the 60-character cap', () => {
    const r = listingSchema.safeParse({ ...base, subtitle: 'x'.repeat(60) })
    expect(r.success).toBe(true)
  })

  it('rejects a subtitle over the cap the database enforces', () => {
    const r = listingSchema.safeParse({ ...base, subtitle: 'x'.repeat(61) })
    expect(r.success).toBe(false)
  })

  it('rejects an original price at or below the asking price', () => {
    expect(listingSchema.safeParse({ ...base, originalPrice: 2500 }).success).toBe(false)
    expect(listingSchema.safeParse({ ...base, originalPrice: 2000 }).success).toBe(false)
  })

  it('accepts an original price above the asking price', () => {
    expect(listingSchema.safeParse({ ...base, originalPrice: 3000 }).success).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run lib/exchange/schema.test.ts`
Expected: FAIL — `CATEGORY_TILE_LABELS` and `LISTING_BADGES` are not exported.

- [ ] **Step 4: Implement the schema changes**

Add to `lib/exchange/schema.ts`:

```ts
export const LISTING_BADGES = ['featured', 'hot', 'top_deal', 'new'] as const
export type ListingBadge = (typeof LISTING_BADGES)[number]

// Long-form labels for the /exchange category tiles. Deliberately separate from
// CATEGORY_LABELS, which stays short for filter chips, the sell form and admin.
export const CATEGORY_TILE_LABELS: Record<ListingCategory, string> = {
  account: 'Game Accounts',
  coins: 'Coins & Currency',
  gift_card: 'Gift Cards',
  accessories: 'Accessories',
  phone: 'Gaming Phones',
  controller: 'Controllers',
}
```

Extend `listingSchema` with the two optional fields, mirroring the DB constraints.
`originalPrice` is cross-field validated against `price` with `.superRefine`, since a
bare field rule cannot see a sibling:

```ts
export const listingSchema = z
  .object({
    // ...existing fields unchanged...
    subtitle: z
      .union([z.literal(''), z.string().trim().max(60, 'Keep it under 60 characters')])
      .optional(),
    originalPrice: z
      .union([z.literal(''), z.coerce.number().int().positive()])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (typeof v.originalPrice === 'number' && v.originalPrice <= v.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['originalPrice'],
        message: 'Original price must be higher than the asking price',
      })
    }
  })
```

`.superRefine` turns `listingSchema` from a `ZodObject` into a `ZodEffects`, which loses
`.extend()` and `.shape`. Verified safe: `lib/exchange/actions.ts` and the existing tests
only call `.safeParse`, which `ZodEffects` still provides. `z.infer<typeof listingSchema>`
also still resolves.

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run lib/exchange/schema.test.ts`
Expected: PASS — the four pre-existing cases plus the new ones.

- [ ] **Step 6: Apply the migration and regenerate types**

Apply `077_exchange_listing_merchandising.sql` to Supabase (MCP `apply_migration`, or the
CLI if it is reachable — see the connectivity note in project memory), then regenerate
`lib/supabase/types.ts`. Confirm `subtitle`, `original_price`, `badge` and `view_count`
appear on `marketplace_listings` in the regenerated file.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/077_exchange_listing_merchandising.sql lib/exchange/schema.ts lib/exchange/schema.test.ts lib/supabase/types.ts
git commit -m "feat(exchange): merchandising columns + tile labels and badge constants"
```

---

### Task 2: Spec-line cascade

**Files:**
- Create: `lib/exchange/subtitle.ts`, `lib/exchange/subtitle.test.ts`

**Interfaces:**
- Consumes: `ListingCategory`, `CATEGORY_LABELS` from Task 1's file.
- Produces: `resolveSpecLine(input: SpecLineInput): string` where
  `SpecLineInput = { subtitle: string | null; description: string | null; gameName: string | null; category: ListingCategory }`,
  and `SPEC_LINE_MAX_LENGTH = 60`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/exchange/subtitle.test.ts
import { describe, it, expect } from 'vitest'
import { resolveSpecLine } from './subtitle'

const base = {
  subtitle: null,
  description: null,
  gameName: null,
  category: 'account' as const,
}

describe('resolveSpecLine', () => {
  it('prefers the seller-written subtitle', () => {
    expect(resolveSpecLine({ ...base, subtitle: 'Max Team | 5★ Players' }))
      .toBe('Max Team | 5★ Players')
  })

  it('falls back to the first line of the description', () => {
    expect(resolveSpecLine({ ...base, description: 'Lv. 70 | Rare Skins\nDM to buy' }))
      .toBe('Lv. 70 | Rare Skins')
  })

  it('truncates a long description line with an ellipsis', () => {
    const line = resolveSpecLine({ ...base, description: 'x'.repeat(200) })
    expect(line.length).toBeLessThanOrEqual(60)
    expect(line.endsWith('…')).toBe(true)
  })

  it('falls back to game and category when there is no text', () => {
    expect(resolveSpecLine({ ...base, gameName: 'Dream League Soccer' }))
      .toBe('Dream League Soccer · Account')
  })

  it('falls back to the category alone when there is no game', () => {
    expect(resolveSpecLine(base)).toBe('Account')
  })

  it('treats whitespace-only text as absent rather than rendering a blank row', () => {
    expect(resolveSpecLine({ ...base, subtitle: '   ', description: '\n \n' })).toBe('Account')
  })

  it('never returns an empty string for any category', () => {
    expect(resolveSpecLine({ ...base, category: 'gift_card' })).toBe('Gift Card')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/exchange/subtitle.test.ts`
Expected: FAIL — module `./subtitle` not found.

- [ ] **Step 3: Implement**

```ts
// lib/exchange/subtitle.ts
import { CATEGORY_LABELS, type ListingCategory } from './schema'

export const SPEC_LINE_MAX_LENGTH = 60

export interface SpecLineInput {
  subtitle: string | null
  description: string | null
  gameName: string | null
  category: ListingCategory
}

function firstMeaningfulLine(text: string | null): string | null {
  if (!text) return null
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line ?? null
}

function truncate(text: string): string {
  return text.length <= SPEC_LINE_MAX_LENGTH
    ? text
    : `${text.slice(0, SPEC_LINE_MAX_LENGTH - 1).trimEnd()}…`
}

// The card's second line, resolved from whatever the listing actually has.
// Always non-empty, so a card never renders a blank row where the spec line goes.
export function resolveSpecLine({ subtitle, description, gameName, category }: SpecLineInput): string {
  const own = firstMeaningfulLine(subtitle) ?? firstMeaningfulLine(description)
  if (own) return truncate(own)

  const label = CATEGORY_LABELS[category]
  return gameName?.trim() ? `${gameName.trim()} · ${label}` : label
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/exchange/subtitle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/subtitle.ts lib/exchange/subtitle.test.ts
git commit -m "feat(exchange): spec-line cascade for listing cards"
```

---

### Task 3: Badges and discount

**Files:**
- Create: `lib/exchange/badges.ts`, `lib/exchange/badges.test.ts`

**Interfaces:**
- Consumes: `ListingBadge` from Task 1.
- Produces: `BADGE_PRESENTATION: Record<ListingBadge, { label: string; className: string }>`,
  `discountPercent(price: number, originalPrice: number | null): number | null`,
  `badgeSortWeight(badge: ListingBadge | null): number`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/exchange/badges.test.ts
import { describe, it, expect } from 'vitest'
import { BADGE_PRESENTATION, discountPercent, badgeSortWeight } from './badges'
import { LISTING_BADGES } from './schema'

describe('BADGE_PRESENTATION', () => {
  it('covers every badge the database allows', () => {
    for (const b of LISTING_BADGES) {
      expect(BADGE_PRESENTATION[b].label).toBeTruthy()
      expect(BADGE_PRESENTATION[b].className).toBeTruthy()
    }
  })

  it('uses the mockup labels', () => {
    expect(BADGE_PRESENTATION.featured.label).toBe('FEATURED')
    expect(BADGE_PRESENTATION.hot.label).toBe('HOT')
    expect(BADGE_PRESENTATION.top_deal.label).toBe('TOP DEAL')
    expect(BADGE_PRESENTATION.new.label).toBe('NEW')
  })
})

describe('discountPercent', () => {
  it('computes the mockup percentages', () => {
    expect(discountPercent(9000, 10000)).toBe(10)
    expect(discountPercent(39000, 42500)).toBe(8)
  })

  it('rounds to the nearest whole percent', () => {
    expect(discountPercent(6667, 10000)).toBe(33)
  })

  it('returns null when there is no original price', () => {
    expect(discountPercent(9000, null)).toBeNull()
  })

  it('returns null when the original price is not above the asking price', () => {
    expect(discountPercent(9000, 9000)).toBeNull()
    expect(discountPercent(9000, 8000)).toBeNull()
  })

  it('returns null rather than dividing by zero', () => {
    expect(discountPercent(0, 0)).toBeNull()
  })
})

describe('badgeSortWeight', () => {
  it('sorts featured listings ahead of everything else', () => {
    expect(badgeSortWeight('featured')).toBeLessThan(badgeSortWeight('hot'))
    expect(badgeSortWeight('hot')).toBeLessThan(badgeSortWeight(null))
    expect(badgeSortWeight(null)).toBeGreaterThan(badgeSortWeight('new'))
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/exchange/badges.test.ts`
Expected: FAIL — module `./badges` not found.

- [ ] **Step 3: Implement**

```ts
// lib/exchange/badges.ts
import type { ListingBadge } from './schema'

export const BADGE_PRESENTATION: Record<ListingBadge, { label: string; className: string }> = {
  featured: { label: 'FEATURED', className: 'bg-sx-purple text-white' },
  hot: { label: 'HOT', className: 'bg-red-600 text-white' },
  top_deal: { label: 'TOP DEAL', className: 'bg-emerald-600 text-white' },
  new: { label: 'NEW', className: 'bg-sky-600 text-white' },
}

// The -10% / -8% pill. Derived arithmetic on the admin-entered was-price, not an
// editorial label, so it needs no control of its own.
export function discountPercent(price: number, originalPrice: number | null): number | null {
  if (originalPrice === null || originalPrice <= price || originalPrice <= 0) return null
  return Math.round(((originalPrice - price) / originalPrice) * 100)
}

const WEIGHTS: Record<ListingBadge, number> = { featured: 0, hot: 1, top_deal: 2, new: 3 }

// Featured first, then the other badges, then unbadged listings.
export function badgeSortWeight(badge: ListingBadge | null): number {
  return badge === null ? 99 : WEIGHTS[badge]
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/exchange/badges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/exchange/badges.ts lib/exchange/badges.test.ts
git commit -m "feat(exchange): badge presentation and derived discount percentage"
```

---

### Task 4: Stat formatting and queries

**Files:**
- Create: `lib/exchange/stats.ts`, `lib/exchange/stats.test.ts`

**Interfaces:**
- Consumes: `formatCompactNumber` from `lib/format.ts`, `LISTING_CATEGORIES` from Task 1.
- Produces: `formatStatCount(n: number): string`,
  `formatPositiveFeedback(completed: number, refunded: number): string`,
  `formatListingCount(n: number): string`,
  `ExchangeStats = { happyGamers: number; successfulTrades: number; verifiedSellers: number; positiveFeedback: string }`,
  `fetchExchangeStats(supabase): Promise<ExchangeStats>`,
  `fetchCategoryCounts(supabase): Promise<Record<ListingCategory, number>>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/exchange/stats.test.ts
import { describe, it, expect } from 'vitest'
import { formatStatCount, formatPositiveFeedback, formatListingCount } from './stats'

describe('formatStatCount', () => {
  it('shows small numbers exactly, because early real numbers are small', () => {
    expect(formatStatCount(0)).toBe('0')
    expect(formatStatCount(12)).toBe('12')
    expect(formatStatCount(950)).toBe('950')
  })

  it('abbreviates with a + once the number is large', () => {
    expect(formatStatCount(1200)).toBe('1.2K+')
    expect(formatStatCount(50000)).toBe('50K+')
  })
})

describe('formatPositiveFeedback', () => {
  it('reports the completion rate to one decimal', () => {
    expect(formatPositiveFeedback(499, 1)).toBe('99.8%')
    expect(formatPositiveFeedback(3, 1)).toBe('75%')
  })

  it('shows an em dash rather than NaN or a misleading 100% with no orders', () => {
    expect(formatPositiveFeedback(0, 0)).toBe('—')
  })

  it('drops a trailing .0', () => {
    expect(formatPositiveFeedback(10, 0)).toBe('100%')
  })
})

describe('formatListingCount', () => {
  it('pluralises correctly and names the empty case', () => {
    expect(formatListingCount(0)).toBe('No listings yet')
    expect(formatListingCount(1)).toBe('1 Listing')
    expect(formatListingCount(2)).toBe('2 Listings')
  })

  it('abbreviates large counts like the mockup', () => {
    expect(formatListingCount(1200)).toBe('1.2K+ Listings')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run lib/exchange/stats.test.ts`
Expected: FAIL — module `./stats` not found.

- [ ] **Step 3: Implement the formatters**

```ts
// lib/exchange/stats.ts
import { formatCompactNumber } from '@/lib/format'
import { LISTING_CATEGORIES, type ListingCategory } from './schema'

const COMPACT_FLOOR = 1000

// Below 1000 the exact number reads better than an abbreviation, and on a young
// marketplace that is the common case. Above it, the mockup's "50K+" style.
export function formatStatCount(n: number): string {
  return n < COMPACT_FLOOR ? String(n) : `${formatCompactNumber(n)}+`
}

// "Positive feedback" is order completion rate — the only real trust signal in
// the schema. There is no marketplace rating table; opponent_ratings is match-only.
export function formatPositiveFeedback(completed: number, refunded: number): string {
  const total = completed + refunded
  if (total === 0) return '—'
  const pct = (completed / total) * 100
  return `${Number(pct.toFixed(1))}%`
}

export function formatListingCount(n: number): string {
  if (n === 0) return 'No listings yet'
  if (n === 1) return '1 Listing'
  return `${n < COMPACT_FLOOR ? n : `${formatCompactNumber(n)}+`} Listings`
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run lib/exchange/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Add the query functions**

Append to `lib/exchange/stats.ts`. These are thin Supabase reads, verified by the page
rendering rather than by unit tests (mocking the query builder would test the mock):

- `fetchExchangeStats(supabase)` issues four head-only counts —
  `profiles` total; `marketplace_orders` where `status = 'completed'`;
  `marketplace_orders` where `status = 'refunded'`; and distinct verified sellers on
  active listings — then returns `ExchangeStats` with `positiveFeedback` already
  formatted. Every count defaults to `0` when Supabase returns null.
- `fetchCategoryCounts(supabase)` selects `category` over active listings and tallies
  them into a record seeded with `0` for every value in `LISTING_CATEGORIES`, so a
  category with no listings still renders its tile.

- [ ] **Step 6: Commit**

```bash
git add lib/exchange/stats.ts lib/exchange/stats.test.ts
git commit -m "feat(exchange): real stat formatting and count queries"
```

---

### Task 5: Rebuild ListingCard

**Files:**
- Modify: `components/exchange/ListingCard.tsx`

**Interfaces:**
- Consumes: `resolveSpecLine` (Task 2), `BADGE_PRESENTATION` / `discountPercent` (Task 3),
  `formatNaira`.
- Produces: `ListingCardData` extended with
  `badge: ListingBadge | null`, `subtitle: string | null`, `description: string | null`,
  `originalPrice: number | null`, `sellerName: string | null`, `sellerVerified: boolean`.

- [ ] **Step 1: Extend `ListingCardData` and the card body**

Structure, top to bottom, inside the existing `Link` to `/exchange/[id]`:

1. Square image area. Badge pill pinned top-left using `BADGE_PRESENTATION[badge]`;
   discount pill (`-10%`) pinned top-right when `discountPercent` is non-null. The
   current category pill is removed — the spec line carries that information now.
2. Title, one line, truncated, white, semibold.
3. Spec line from `resolveSpecLine`, muted, one line, truncated.
4. Seller row: `sellerName`, muted and small, followed by a purple `BadgeCheck` icon
   when `sellerVerified`. Row is omitted entirely when `sellerName` is null.
5. Price row: `formatNaira(price)` in purple and bold; when `originalPrice` is set,
   `formatNaira(originalPrice)` beside it, muted with `line-through`. A purple
   rounded `ShoppingCart` button sits at the right end of the row.

Card surface uses `bg-sx-surface` with `border-sx-border`, hovering to
`border-sx-purple/40`.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only at the existing call site in `exchange/page.tsx`, which Task 13
rewrites. Fix any error inside `ListingCard.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/ListingCard.tsx
git commit -m "feat(exchange): listing card with badge, spec line, seller and was-price"
```

---

### Task 6: Hero section

**Files:**
- Create: `components/exchange/ExchangeHero.tsx`

**Interfaces:**
- Produces: `<ExchangeHero />` — no props, fully static.

- [ ] **Step 1: Build the hero**

Copy is literal, from the spec:

- Eyebrow `GAMING EXCHANGE`, purple, uppercase, tracked.
- Headline `BUY. SELL. TRADE.` (white) over `PLAY MORE.` (purple), display font, black weight.
- Subhead lines `The most trusted marketplace for gamers.` and
  `Accounts, coins, gift cards & more – all in one place.`
- Four trust pills: BadgeCheck / Verified Sellers / 100% Verified · ShieldCheck / Safe
  Trades / Escrow Protection · Tag / Best Prices / Compare & Save · Headphones /
  24/7 Support / We've got you.
- Buttons: `Browse Listings` (purple, `ShoppingBag`, href `#featured-listings`) and
  `Sell an Item` (bordered, `Upload`, href `/exchange/new`).
- Mascot from `public/mascot/` behind a radial `sx-purple-glow`, using `next/image`.
- "Hey Gamer" card: `Hey Gamer! 👋`, three icon rows (`Find epic deals`, `Trade safely`,
  `Level up your game`), the line `All backed by ZOLARUX ESCROW protection.` with
  `ZOLARUX` emphasised, and a purple `Learn More` button to `/escrow`.

Responsive: at mobile, text full width, mascot smaller and centred below the buttons,
trust pills `grid-cols-2`, buttons full-width stacked, "Hey Gamer" card last.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/ExchangeHero.tsx
git commit -m "feat(exchange): hero section"
```

---

### Task 7: Escrow strip

**Files:**
- Create: `components/exchange/EscrowStrip.tsx`

**Interfaces:**
- Produces: `<EscrowStrip />` — no props, fully static.

- [ ] **Step 1: Build the strip**

A single rounded `bg-sx-surface` bar containing:

- Green `ShieldCheck`, `TRADE SAFE. TRADE SMART.` bold white, and
  `All transactions are protected by Zolarux Escrow.` muted beneath.
- Three steps, each a purple numbered circle plus a two-line label:
  `1 Buyer Pays / Funds held securely`, `2 You Deliver / Item delivered`,
  `3 Buyer Confirms / You get paid`, separated by `ArrowRight` icons.
- Right cap: green `CheckCircle2`, `100% SAFE` bold, `or Your Money Back` muted.

Responsive: steps stack vertically at mobile with the arrows rotated 90°
(`rotate-90 sm:rotate-0`); the safety cap moves last.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/EscrowStrip.tsx
git commit -m "feat(exchange): escrow trust strip"
```

---

### Task 8: Category grid

**Files:**
- Create: `components/exchange/CategoryGrid.tsx`

**Interfaces:**
- Consumes: `CATEGORY_TILE_LABELS` (Task 1), `formatListingCount` (Task 4).
- Produces: `<CategoryGrid counts={...} />` where
  `counts: Record<ListingCategory, number>`.

- [ ] **Step 1: Build the grid**

Panel headed `BROWSE CATEGORIES`. Six tiles, ordered
`account, coins, gift_card, accessories, phone, controller`, each linking to
`/exchange?category=<value>` and rendering a purple `lucide-react` icon
(`Gamepad2`, `Coins`, `CreditCard`, `Headphones`, `Smartphone`, `Gamepad`), the label
from `CATEGORY_TILE_LABELS`, and `formatListingCount(counts[value])` in muted small text.

The icon map is a module-level `Record<ListingCategory, LucideIcon>` so a new category
fails to typecheck rather than rendering a blank tile.

Responsive: `grid-cols-6` at `lg`; at mobile a horizontal scroll row
(`flex overflow-x-auto snap-x`) with fixed-width tiles and no wrap.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/CategoryGrid.tsx
git commit -m "feat(exchange): category tiles with live counts"
```

---

### Task 9: Featured listings grid

**Files:**
- Create: `components/exchange/FeaturedListings.tsx`

**Interfaces:**
- Consumes: `ListingCard` / `ListingCardData` (Task 5).
- Produces: `<FeaturedListings listings={ListingCardData[]} />`.

- [ ] **Step 1: Build the section**

Wrapper carries `id="featured-listings"` so the hero's `Browse Listings` button anchors
to it. Header row: orange `Flame`, `FEATURED LISTINGS` bold white, muted
`Hot deals from verified sellers`, and a purple `View All Categories` link to `/exchange`
on the right.

Grid: `grid-cols-2` at mobile, `lg:grid-cols-4`. When `listings` is empty, render the
existing `EmptyState` with the current copy rather than a bare grid.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/FeaturedListings.tsx
git commit -m "feat(exchange): featured listings grid"
```

---

### Task 10: Quick actions and trust sidebar panels

**Files:**
- Create: `components/exchange/QuickActionsPanel.tsx`, `components/exchange/TrustPanel.tsx`

**Interfaces:**
- Produces: `<QuickActionsPanel signedIn={boolean} />` and `<TrustPanel />`.

- [ ] **Step 1: Build QuickActionsPanel**

Headed `QUICK ACTIONS`. When `signedIn`, three rows, each an icon tile plus title and sub:
`Upload / Sell an Item / List your item in minutes` → `/exchange/new`;
`LayoutList / My Listings / Manage your items` → `/dashboard/marketplace`;
`Package / My Orders / Track your orders` → `/dashboard/marketplace`.

When not signed in, render instead a single card: heading
`Start trading on Sentinel X`, body `Create an account to buy and sell safely.`,
a purple `Create Account` button to `/signup`, and a muted `Log in` link to
`/login?next=/exchange`.

- [ ] **Step 2: Build TrustPanel**

Headed `WHY GAMERS TRUST US`. Four static rows:
green `ShieldCheck` / `Zolarux Escrow` / `100% Secure Transactions`;
purple `BadgeCheck` / `Verified Sellers Only` / `Every seller is verified`;
white `Headphones` / `24/7 Customer Support` / `We're here anytime`;
blue `Shield` / `Buyer Protection` / `Money back guarantee`.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in these files.

- [ ] **Step 4: Commit**

```bash
git add components/exchange/QuickActionsPanel.tsx components/exchange/TrustPanel.tsx
git commit -m "feat(exchange): quick actions and trust sidebar panels"
```

---

### Task 11: Trending Now panel

**Files:**
- Create: `components/exchange/TrendingNow.tsx`

**Interfaces:**
- Consumes: `ListingCardData` (Task 5), `resolveSpecLine` (Task 2), `formatNaira`.
- Produces: `<TrendingNow listings={ListingCardData[]} />`.

- [ ] **Step 1: Build the panel**

Headed `TRENDING NOW` with a purple `View All` link to `/exchange` on the right. Four
compact rows, each linking to `/exchange/[id]`: a small square thumbnail
(`primaryImage`, falling back to a muted controller glyph), then title (truncated,
white), spec line (muted, truncated), and `formatNaira(price)` in purple beneath.

Renders nothing at all when `listings` is empty — an empty "Trending" panel is worse
than no panel.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/TrendingNow.tsx
git commit -m "feat(exchange): trending now sidebar panel"
```

---

### Task 12: Join CTA band

**Files:**
- Create: `components/exchange/JoinCtaBand.tsx`

**Interfaces:**
- Consumes: `ExchangeStats` and `formatStatCount` (Task 4).
- Produces: `<JoinCtaBand stats={ExchangeStats} signedIn={boolean} />`.

- [ ] **Step 1: Build the band**

Rounded `bg-sx-surface` band with the mascot at the left edge. Centre column:
`JOIN THOUSANDS OF GAMERS TRADING EVERY DAY` bold white, then
`Save more. Play more. Level up with Sentinel X Gaming Exchange.` muted, then a four-stat
row — each an icon (`Users`, `CheckCircle2`, `UserCheck`, `Star`), a large bold value, and
a muted label:

| Value | Label |
|---|---|
| `formatStatCount(stats.happyGamers)` | Happy Gamers |
| `formatStatCount(stats.successfulTrades)` | Successful Trades |
| `formatStatCount(stats.verifiedSellers)` | Verified Sellers |
| `stats.positiveFeedback` (already formatted) | Positive Feedback |

Right: a bordered box with `Trade smart. Trade safe.` bold, `Trade only on Sentinel X.`
muted, and a purple `Get Started Now` button to `/exchange/new` when `signedIn`, else
`/signup`.

Responsive: mascot above the headline at mobile, stats `grid-cols-2`, CTA box full width.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add components/exchange/JoinCtaBand.tsx
git commit -m "feat(exchange): join CTA band with real platform stats"
```

---

### Task 13: Compose the page

**Files:**
- Modify: `app/[locale]/(public)/exchange/page.tsx`

**Interfaces:**
- Consumes: every component from Tasks 5–12, plus `fetchExchangeStats` and
  `fetchCategoryCounts` (Task 4) and `badgeSortWeight` (Task 3).

- [ ] **Step 1: Rewrite the page**

Keep `generateMetadata` exactly as it is. The component:

1. Creates the Supabase server client and reads the current user (for `signedIn`).
2. Selects active listings with the new columns plus
   `games(name)`, `listing_images(image_url, display_order)` and
   `profiles!marketplace_listings_seller_id_fkey(username, display_name, kyc_verified)`,
   honouring the existing `?category=` filter.
3. Maps rows to `ListingCardData`, resolving the seller name as
   `display_name ?? username`.
4. Sorts by `badgeSortWeight(badge)`, then newest first.
5. Runs `fetchCategoryCounts` and `fetchExchangeStats`, and a separate four-row
   trending query ordered by `view_count` descending.
6. Renders, in order: `ExchangeHero`, `EscrowStrip`, then a two-column grid
   (`lg:grid-cols-12` — main `lg:col-span-8`, sidebar `lg:col-span-4`) containing
   `CategoryGrid` + `FeaturedListings` on the left and `QuickActionsPanel` +
   `TrustPanel` + `TrendingNow` on the right, then `JoinCtaBand`.

The existing `FilterChip` row is removed — the category tiles are the filter now. The
page container widens from `max-w-5xl` to `max-w-7xl` to match the mockup's proportions.

Independent reads are issued with `Promise.all` so the page makes one round of queries,
not four sequential ones.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 3: Run the exchange tests**

Run: `npx vitest run lib/exchange`
Expected: all pass. Do not run the root suite — the linked i18n worktree double-counts it.

- [ ] **Step 4: Look at the page**

Start the dev server and open `/exchange` at 375px and at desktop width. Compare
against `public/visual_bible/store_page.jpeg` section by section: hero, escrow strip,
categories, listings, sidebar, join band. Fix visual drift before committing.

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/\(public\)/exchange/page.tsx
git commit -m "feat(exchange): compose rebuilt exchange page"
```

---

### Task 14: Seller form, admin controls, and view counting

**Files:**
- Modify: `components/exchange/ListingForm.tsx`,
  `app/[locale]/admin/exchange/page.tsx`,
  `app/[locale]/(public)/exchange/[id]/page.tsx`,
  `lib/exchange/actions.ts`

**Interfaces:**
- Consumes: `listingSchema` with `subtitle` / `originalPrice` (Task 1),
  `LISTING_BADGES` and `BADGE_PRESENTATION` (Tasks 1 and 3).

- [ ] **Step 1: Add the seller fields**

In `ListingForm.tsx`, add a `subtitle` text input labelled "Short description" with
helper text "One line shown on your listing card — e.g. Max Team | 5★ Players" and a
60-character `maxLength`, plus an optional "Original price" number input with helper
text "Shows a crossed-out was-price and a discount badge. Leave empty if not on offer."
Wire both through the existing action so they persist; the zod schema already validates
them.

- [ ] **Step 2: Add the admin badge control**

In the admin exchange page, add a badge selector per listing offering
`None` plus the four `LISTING_BADGES` values (labelled via `BADGE_PRESENTATION`), and an
editable original price. Both save through a staff-guarded server action in
`lib/exchange/actions.ts` that verifies staff role server-side before writing —
never trust a client-submitted role.

- [ ] **Step 3: Count views on the detail page**

In `exchange/[id]/page.tsx`, call the `increment_listing_view` RPC for the listing being
viewed. Wrap it so a failure can never break the render:

```ts
// A view counter must never take the page down.
void supabase.rpc('increment_listing_view', { p_listing_id: id }).then(
  () => undefined,
  () => undefined,
)
```

- [ ] **Step 4: Typecheck, build, and test**

Run: `npx tsc --noEmit && npm run build && npx vitest run lib/exchange`
Expected: all clean.

- [ ] **Step 5: Verify end to end**

Create a listing with a subtitle and an original price; confirm the card shows the spec
line, the struck-through price and the derived discount pill. Set a badge in admin;
confirm it appears and that the listing sorts to the front. Open a listing twice;
confirm `view_count` increments and the listing appears in Trending Now.

- [ ] **Step 6: Commit**

```bash
git add components/exchange/ListingForm.tsx app/\[locale\]/admin/exchange/page.tsx app/\[locale\]/\(public\)/exchange/\[id\]/page.tsx lib/exchange/actions.ts
git commit -m "feat(exchange): seller subtitle/was-price, admin badges, view counting"
```

---

## Verification before completion

- [ ] `npx vitest run lib/exchange` — all pass (never trust root suite totals)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — clean
- [ ] `npm run lint` — clean
- [ ] `/exchange` compared against `public/visual_bible/store_page.jpeg` at desktop width
- [ ] `/exchange` browsed at 375px with no horizontal scroll
- [ ] Signed-out visit shows the sign-up card in place of Quick Actions
- [ ] Empty-state check: a category with no listings still renders its tile
