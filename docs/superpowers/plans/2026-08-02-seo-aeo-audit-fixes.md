# SEO/AEO Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four concrete SEO/AEO gaps found during an audit of the existing (already mature) SEO setup: a missing sitemap entry, empty alt text on content images that have real text available, missing breadcrumb schema on two page types, and a missing `llms.txt`.

**Architecture:** Four independent, low-risk changes — no shared design decisions between them. Each is a direct edit to existing patterns already used elsewhere in the codebase (matching the existing sitemap/breadcrumb/alt-text conventions), plus one new static route handler.

**Tech Stack:** Next.js 14 App Router file conventions, Vitest.

## Global Constraints

- Do not touch anything the audit found clean: existing metadata coverage, Organization/WebSite JSON-LD, dynamic sitemap entries, robots.txt, homepage FAQ.
- Alt-text fixes only apply to images identified in the spec (`ListingCard`, `ImageGallery` thumbnails, `VideoCard`, `MatchVideoCard`) — do not touch `PostCard.tsx`'s image grid (no per-image title exists) or any admin-only component.
- `llms.txt` content is static (no DB queries) — it's a stable reference document, not a live data feed.

---

## File Structure

- `lib/seo/sitemap-entries.ts` — modify: add `/betting` to `staticSitemapEntries()`.
- `lib/seo/sitemap-entries.test.ts` — modify: update the expected URL array.
- `components/exchange/ListingCard.tsx` — modify: real alt text.
- `components/exchange/ImageGallery.tsx` — modify: real alt text on thumbnail strip.
- `components/tv/VideoCard.tsx` — modify: real alt text.
- `components/tv/MatchVideoCard.tsx` — modify: real alt text.
- `app/(public)/matches/[id]/page.tsx` — modify: add breadcrumb JSON-LD.
- `app/(public)/tournaments/[slug]/results/page.tsx` — modify: add breadcrumb JSON-LD.
- `app/llms.txt/route.ts` — new: static `llms.txt` route handler.

---

### Task 1: Add `/betting` to the sitemap

**Files:**
- Modify: `lib/seo/sitemap-entries.ts:4-18`
- Modify: `lib/seo/sitemap-entries.test.ts:11-27`

- [ ] **Step 1: Update the failing test first**

In `lib/seo/sitemap-entries.test.ts`, change the expected array:

```ts
describe('staticSitemapEntries', () => {
  it('includes every top-level public route', () => {
    const urls = staticSitemapEntries().map((e) => e.url)
    expect(urls).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/tournaments`,
      `${SITE_URL}/players`,
      `${SITE_URL}/rankings`,
      `${SITE_URL}/hall-of-fame`,
      `${SITE_URL}/tv`,
      `${SITE_URL}/exchange`,
      `${SITE_URL}/community`,
      `${SITE_URL}/games`,
      `${SITE_URL}/about`,
      `${SITE_URL}/betting`,
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/seo/sitemap-entries.test.ts`
Expected: FAIL — actual array is missing `${SITE_URL}/betting`.

- [ ] **Step 3: Add `/betting` to `staticSitemapEntries()`**

In `lib/seo/sitemap-entries.ts`, change:

```ts
export function staticSitemapEntries(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    '/tournaments',
    '/players',
    '/rankings',
    '/hall-of-fame',
    '/tv',
    '/exchange',
    '/community',
    '/games',
    '/about',
  ]
  return paths.map((path) => ({ url: `${SITE_URL}${path === '/' ? '/' : path}` }))
}
```

to:

```ts
export function staticSitemapEntries(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    '/tournaments',
    '/players',
    '/rankings',
    '/hall-of-fame',
    '/tv',
    '/exchange',
    '/community',
    '/games',
    '/about',
    '/betting',
  ]
  return paths.map((path) => ({ url: `${SITE_URL}${path === '/' ? '/' : path}` }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/seo/sitemap-entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/seo/sitemap-entries.ts lib/seo/sitemap-entries.test.ts
git commit -m "fix(seo): add /betting to the sitemap"
```

---

### Task 2: Real alt text on content images

**Files:**
- Modify: `components/exchange/ListingCard.tsx:23`
- Modify: `components/exchange/ImageGallery.tsx:29`
- Modify: `components/tv/VideoCard.tsx:30`
- Modify: `components/tv/MatchVideoCard.tsx:18`

No test — direct JSX attribute changes, verified by reading the rendered HTML.

- [ ] **Step 1: `ListingCard.tsx`**

Change:

```tsx
<img src={listing.primaryImage} alt="" className="h-full w-full object-cover" />
```

to:

```tsx
<img src={listing.primaryImage} alt={listing.title} className="h-full w-full object-cover" />
```

- [ ] **Step 2: `ImageGallery.tsx` thumbnail strip**

The main image (line 17) already correctly uses `alt={title}` — leave it. Change only the thumbnail strip:

```tsx
{images.map((src, i) => (
  <button
    key={src}
    type="button"
    onClick={() => setActive(i)}
    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border ${i === active ? 'border-violet-500' : 'border-slate-800'}`}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="" className="h-full w-full object-cover" />
  </button>
))}
```

to:

```tsx
{images.map((src, i) => (
  <button
    key={src}
    type="button"
    onClick={() => setActive(i)}
    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border ${i === active ? 'border-violet-500' : 'border-slate-800'}`}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={`${title} photo ${i + 1}`} className="h-full w-full object-cover" />
  </button>
))}
```

- [ ] **Step 3: `VideoCard.tsx`**

Change:

```tsx
<img src={thumb} alt="" className="h-full w-full object-cover" />
```

to:

```tsx
<img src={thumb} alt={video.title} className="h-full w-full object-cover" />
```

- [ ] **Step 4: `MatchVideoCard.tsx`**

Change:

```tsx
<img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
```

to:

```tsx
<img src={video.thumbnailUrl} alt={video.title} className="h-full w-full object-cover" />
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, visit `/exchange`, `/exchange/[id]`, and `/tv`, and confirm via browser dev tools (Elements panel, or view-source) that the `<img>` tags for listing photos and video thumbnails now carry non-empty `alt` text matching the listing/video title.

- [ ] **Step 7: Commit**

```bash
git add components/exchange/ListingCard.tsx components/exchange/ImageGallery.tsx components/tv/VideoCard.tsx components/tv/MatchVideoCard.tsx
git commit -m "fix(seo): add descriptive alt text to content images"
```

---

### Task 3: Breadcrumb JSON-LD on matches and results pages

**Files:**
- Modify: `app/(public)/matches/[id]/page.tsx`
- Modify: `app/(public)/tournaments/[slug]/results/page.tsx`

No test — structured data wiring, verified by reading the rendered `<script type="application/ld+json">` output.

- [ ] **Step 1: Add breadcrumb to the Match Centre page**

In `app/(public)/matches/[id]/page.tsx`, add the import alongside the existing schema import:

```ts
import { buildMatchJsonLd } from '@/lib/seo/schema/event'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
```

Then, right after the existing `<JsonLd data={buildMatchJsonLd({...})} />` block in the JSX, add:

```tsx
      {m.tournaments ? (
        <JsonLd
          data={buildBreadcrumbJsonLd([
            { name: 'Tournaments', path: '/tournaments' },
            { name: m.tournaments.title, path: `/tournaments/${m.tournaments.slug}` },
            { name: `${nameOf(m.player_a)} vs ${nameOf(m.player_b)}`, path: `/matches/${m.id}` },
          ])}
        />
      ) : (
        <JsonLd
          data={buildBreadcrumbJsonLd([
            { name: `${nameOf(m.player_a)} vs ${nameOf(m.player_b)}`, path: `/matches/${m.id}` },
          ])}
        />
      )}
```

- [ ] **Step 2: Add breadcrumb to the Tournament Results page**

In `app/(public)/tournaments/[slug]/results/page.tsx`, add the import:

```ts
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
```

Then, right after the opening `<div className="mx-auto max-w-3xl px-4 pb-20">` in the returned JSX, add:

```tsx
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Tournaments', path: '/tournaments' },
          { name: t.title, path: `/tournaments/${t.slug}` },
          { name: 'Results', path: `/tournaments/${t.slug}/results` },
        ])}
      />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, visit a real match page and a real tournament results page, view page source, and confirm a `<script type="application/ld+json">` block with `"@type":"BreadcrumbList"` is present with the expected `itemListElement` entries on both.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/matches/[id]/page.tsx" "app/(public)/tournaments/[slug]/results/page.tsx"
git commit -m "fix(seo): add breadcrumb schema to matches and results pages"
```

---

### Task 4: `llms.txt`

**Files:**
- Create: `app/llms.txt/route.ts`

No test — static text content, verified by reading the served response.

- [ ] **Step 1: Write the route handler**

```ts
// app/llms.txt/route.ts
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL } from '@/lib/seo/site'

const PAGES: { title: string; path: string; description: string }[] = [
  { title: 'Tournaments', path: '/tournaments', description: 'current, upcoming, and past tournaments with brackets and prize pools' },
  { title: 'Rankings', path: '/rankings', description: 'player leaderboards' },
  { title: 'Hall of Fame', path: '/hall-of-fame', description: 'season champions and award winners' },
  { title: 'Sentinel X TV', path: '/tv', description: 'live streams, replays, and highlights' },
  { title: 'Gaming Exchange', path: '/exchange', description: 'peer-to-peer gaming account and item trading' },
  { title: 'Community', path: '/community', description: 'player posts and discussions' },
  { title: 'About', path: '/about', description: 'platform story and mission' },
]

export function GET() {
  const pageLines = PAGES.map((p) => `- [${p.title}](${SITE_URL}${p.path}): ${p.description}`).join('\n')

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}
> A mobile esports platform where players compete in tournaments, watch live matches and replays, connect with the community, and trade gaming accounts and items safely. Supports Dream League Soccer today, built to grow across other mobile games.

## Pages

${pageLines}
`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, `curl http://localhost:3000/llms.txt`, confirm it returns `text/plain` content matching the format above with all 7 page links present and correct.

- [ ] **Step 4: Commit**

```bash
git add app/llms.txt/route.ts
git commit -m "feat(seo): add llms.txt"
```

---

## Self-Review Notes

- **Spec coverage:** all four spec items have a task (sitemap entry → Task 1, alt text → Task 2, breadcrumbs → Task 3, llms.txt → Task 4). The spec's "explicitly not touched" list (PostCard, admin components) has no corresponding task, as intended.
- **Placeholder scan:** none — every step has runnable code.
- **Type consistency:** breadcrumb items use the existing `BreadcrumbItem = { name: string; path: string }` type from `lib/seo/schema/breadcrumb.ts` throughout, matching the shape already used by the player/tournament/bracket/exchange pages.
