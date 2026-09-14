# SEO & AEO Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed SEO/AEO gaps on the live Sentinel X site — explicit AI-crawler robots rules, full FAQ/Breadcrumb/EventSeries structured data coverage, richer Open Graph typing, a fuller `llms-full.txt`, per-section OG images, and a couple of small metadata/cleanup gaps — all built on the SEO infrastructure that already exists (`lib/seo/metadata.ts`, `lib/seo/schema/*`, `lib/og/template.tsx`).

**Architecture:** No new subsystem. Every task extends an existing, already-proven pattern in this codebase: `buildMetadata()` for page `<head>` metadata, `<JsonLd data={...}/>` + a `lib/seo/schema/*.ts` builder for structured data, and `renderOgImage()` + a segment `opengraph-image.tsx` file for social preview images.

**Tech Stack:** Next.js 14 App Router (file-convention `opengraph-image.tsx`/`robots.ts`), TypeScript, `next-intl`, Vitest for unit tests.

**Spec:** This plan was scoped directly in conversation (brainstorming session, 2026-09-14) rather than a separate spec doc — the punch list below **is** the spec; each task states its own rationale and exact content.

## Global Constraints

- Every new/changed page still goes through `buildMetadata()` for canonical + hreflang — never hand-roll a `Metadata` object for a page that already uses it.
- Every new JSON-LD block renders via the existing `<JsonLd data={...} />` component — never a hand-written `<script>` tag.
- New OG-image files follow the existing `renderOgImage({ title, subtitle })` convention from `lib/og/template.tsx` (`export const runtime = 'edge'`, `export const size = OG_SIZE`, `export const contentType = 'image/png'`) — no new visual template, no custom fonts (Satori can't parse the site's variable fonts — see the comment in `lib/og/template.tsx`).
- `SITE_URL`, `SITE_NAME` come from `lib/seo/site.ts` — never re-declare them locally.
- Keep OG-image and `llms-full.txt` copy in English only (matches every existing OG-image file in the repo — none are localized today; localizing them is a separate, unrequested feature).
- Design correction from the brainstorm: `og:type: 'product'` was proposed for exchange listings, but Next's `OpenGraphType` union (`node_modules/next/dist/lib/metadata/types/opengraph-types.d.ts`) does not include `'product'` — it is not a real Open Graph/Next-supported type. That idea is dropped; the existing `Product` JSON-LD (`lib/seo/schema/listing.ts`, already shipped) is the correct, already-implemented mechanism for listing price/availability data. Task 5 below only adds `locale`/`alternateLocale` (universal) and `type: 'profile'` / `type: 'article'`, both real Next-supported OG types.

---

### Task 1: AI-crawler rules in `robots.txt`

**Files:**
- Modify: `app/robots.ts`

**Interfaces:**
- Produces: no new exports — `robots()` still returns `MetadataRoute.Robots`, just with `rules` as an array of groups instead of one object.

- [ ] **Step 1: Rewrite `app/robots.ts` with explicit per-bot groups**

Every group repeats the same allow/disallow as the current wildcard rule — the behavior is nearly unchanged, but naming the AI crawlers explicitly is the actual AEO signal (some crawlers are treated differently when unnamed, and this documents the site's intent to be indexed by answer engines).

```ts
import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

const DISALLOW = ['/admin', '/dashboard', '/api', '/login', '/signup', '/forgot-password', '/reset-password']

// Named explicitly (rather than relying on the '*' wildcard alone) so answer
// engines and AI crawlers see an unambiguous, intentional allow — the actual
// AEO lever. Covers the major search-driven AI crawlers (live retrieval /
// answer generation) and the major bulk model-training crawlers alike; the
// platform wants to be citable in AI answers about Nigerian mobile esports.
const AI_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'anthropic-ai',
  'cohere-ai',
  'Applebot-Extended',
  'Bytespider',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_USER_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow: DISALLOW })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
```

- [ ] **Step 2: Verify the route builds**

Run: `npx next build --no-lint 2>&1 | head -50` is slow for a one-file check — instead just type-check: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i robots`
Expected: no output (no type errors referencing `app/robots.ts`).

- [ ] **Step 3: Commit**

```bash
git add app/robots.ts
git commit -m "feat(seo): name AI crawlers explicitly in robots.txt"
```

---

### Task 2: `FAQPage` JSON-LD on `/tournaments` and `/tournament-faqs`

**Files:**
- Modify: `app/[locale]/(public)/tournaments/page.tsx`
- Modify: `app/[locale]/(public)/tournament-faqs/page.tsx`

**Interfaces:**
- Consumes: `buildFaqJsonLd(items: FaqItem[])` from `lib/seo/schema/faq.ts` (existing), `JsonLd` from `components/seo/JsonLd.tsx` (existing), `TOURNAMENT_FAQS` from `lib/seo/faq-content.ts` (existing).

- [ ] **Step 1: Add the FAQ JSON-LD block to `/tournaments`**

`TOURNAMENT_FAQS` is already rendered visually by `TournamentFaqCard()` in this file (`app/[locale]/(public)/tournaments/page.tsx:320-342`) but has no matching structured data. Add the import and render it once, at the top level of the page's returned JSX (same placement pattern as the homepage: `app/[locale]/page.tsx:184-185`).

In `app/[locale]/(public)/tournaments/page.tsx`, add to the import block (near the other `lib/seo` imports at the top):

```ts
import { TOURNAMENT_FAQS } from '@/lib/seo/faq-content'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
```

(`TOURNAMENT_FAQS` is already imported — just add the two new imports alongside it.)

Then, inside `export default async function TournamentsPage(...)`, add the JSON-LD block as the first child of the returned `<div className="mx-auto max-w-7xl ...">`, immediately before the `{/* ── Hero ── */}` section comment:

```tsx
      <JsonLd data={buildFaqJsonLd(TOURNAMENT_FAQS)} />
```

- [ ] **Step 2: Add the FAQ JSON-LD block to `/tournament-faqs`**

This page builds its 10 Q&A pairs from translated strings (`t('q1')`/`t('a1')` … `t('q10')`/`t('a10')`) into `groups[0].items` as `{ q, a }`. `buildFaqJsonLd` expects `FaqItem[]` (`{ question, answer }`), so map the shape.

In `app/[locale]/(public)/tournament-faqs/page.tsx`, add to the imports:

```ts
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
```

Then change the return statement from:

```tsx
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
```

to:

```tsx
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <JsonLd data={buildFaqJsonLd(groups[0].items.map((item) => ({ question: item.q, answer: item.a })))} />
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
```

- [ ] **Step 3: Manually verify both pages render valid JSON-LD**

Run the dev server (`npm run dev`), visit `/tournaments` and `/tournament-faqs`, and view source — confirm a `<script type="application/ld+json">` block appears on each containing a `"@type": "FAQPage"` with 5 (tournaments) / 10 (tournament-faqs) `mainEntity` items. (This mirrors how the rest of `lib/seo` is verified — page-level JSON-LD wiring isn't unit tested elsewhere in this codebase either; `buildFaqJsonLd` itself is a pure function with no test gap to fill here.)

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/tournaments/page.tsx" "app/[locale]/(public)/tournament-faqs/page.tsx"
git commit -m "feat(seo): add FAQPage JSON-LD to /tournaments and /tournament-faqs"
```

---

### Task 3: `BreadcrumbList` JSON-LD on the community post page

**Files:**
- Modify: `app/[locale]/(public)/community/[postId]/page.tsx`

**Interfaces:**
- Consumes: `buildBreadcrumbJsonLd(items: BreadcrumbItem[])` from `lib/seo/schema/breadcrumb.ts` (existing — already wired into 6 other detail pages: tournament, match, player, listing, tournament bracket/results).

`BreadcrumbList` is already live on `players/[username]`, `tournaments/[slug]` (+ `/bracket`, `/results`), `matches/[id]`, `exchange/[id]`, and `seasons/[slug]` — the one drill-down detail page missing it is the community post page.

- [ ] **Step 1: Add breadcrumb JSON-LD to the community post page**

In `app/[locale]/(public)/community/[postId]/page.tsx`, add to the imports:

```ts
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
```

Then, inside `export default async function PostDetailPage(...)`, add the JSON-LD block as the first child of the returned `<div className="mx-auto max-w-2xl px-4 pb-20">`, before `<CommunityRealtime postId={params.postId} />`:

```tsx
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Community', path: '/community' },
          { name: post.content.slice(0, 60), path: `/community/${params.postId}` },
        ])}
      />
```

- [ ] **Step 2: Manually verify**

Visit any `/community/[postId]` page in dev and view source — confirm a `<script type="application/ld+json">` with `"@type": "BreadcrumbList"` and two `itemListElement` entries.

- [ ] **Step 3: Commit**

```bash
git add "app/[locale]/(public)/community/[postId]/page.tsx"
git commit -m "feat(seo): add BreadcrumbList JSON-LD to community post pages"
```

---

### Task 4: `EventSeries` JSON-LD for `/seasons/[slug]`

**Files:**
- Create: `lib/seo/schema/season.ts`
- Test: `lib/seo/schema/season.test.ts`
- Modify: `app/[locale]/seasons/[slug]/page.tsx`

**Interfaces:**
- Produces: `buildSeasonJsonLd(input: SeasonEventSeriesInput)` returning a plain JSON-LD object — same shape convention as `buildTournamentJsonLd`/`buildMatchJsonLd` in `lib/seo/schema/event.ts`.
- Consumes (in the page): the `season` row already loaded by `getSeason()` in that file (`{ name, slug, start_date, end_date, status }`, confirmed columns — `supabase/migrations/047_season_system.sql:6-17`).

`seasons/[slug]` already has `BreadcrumbList` JSON-LD (`app/[locale]/seasons/[slug]/page.tsx:77-82`) but no `@type`-specific structured data describing the season itself, unlike tournaments (`SportsEvent`) and players (`ProfilePage`). A season is a collection of tournaments across a fixed date range — schema.org's `EventSeries` type fits directly.

- [ ] **Step 1: Write the failing test**

```ts
// lib/seo/schema/season.test.ts
import { describe, it, expect } from 'vitest'
import { buildSeasonJsonLd } from './season'
import { SITE_URL, SITE_NAME } from '../site'

describe('buildSeasonJsonLd', () => {
  it('builds an EventSeries with the season url, dates, and organizer', () => {
    const result = buildSeasonJsonLd({
      name: 'Season 3',
      slug: 'season-3',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    })
    expect(result).toEqual({
      '@context': 'https://schema.org',
      '@type': 'EventSeries',
      name: 'Season 3',
      description: "Season 3 on Sentinel X — tournaments across every game, and the road to the top of each leaderboard.",
      url: `${SITE_URL}/seasons/season-3`,
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/seo/schema/season.test.ts`
Expected: FAIL — `Cannot find module './season'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/seo/schema/season.ts
import { SITE_URL, SITE_NAME } from '../site'

export type SeasonEventSeriesInput = {
  name: string
  slug: string
  startDate: string
  endDate: string
}

export function buildSeasonJsonLd(s: SeasonEventSeriesInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'EventSeries',
    name: s.name,
    description: `${s.name} on Sentinel X — tournaments across every game, and the road to the top of each leaderboard.`,
    url: `${SITE_URL}/seasons/${s.slug}`,
    startDate: s.startDate,
    endDate: s.endDate,
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/seo/schema/season.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the season page**

In `app/[locale]/seasons/[slug]/page.tsx`, add to the imports:

```ts
import { buildSeasonJsonLd } from '@/lib/seo/schema/season'
```

Then add a second `<JsonLd>` block right after the existing breadcrumb one:

```tsx
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: season.name, path: `/seasons/${season.slug}` },
        ])}
      />
      <JsonLd
        data={buildSeasonJsonLd({
          name: season.name,
          slug: season.slug,
          startDate: season.start_date,
          endDate: season.end_date,
        })}
      />
```

- [ ] **Step 6: Commit**

```bash
git add lib/seo/schema/season.ts lib/seo/schema/season.test.ts "app/[locale]/seasons/[slug]/page.tsx"
git commit -m "feat(seo): add EventSeries JSON-LD to season pages"
```

---

### Task 5: Richer Open Graph typing — `locale`, `profile`, `article`

**Files:**
- Modify: `lib/seo/metadata.ts`
- Test: `lib/seo/metadata.test.ts`
- Modify: `app/[locale]/(public)/players/[username]/page.tsx`
- Modify: `app/[locale]/(public)/community/[postId]/page.tsx`

**Interfaces:**
- Produces: `BuildMetadataInput`'s existing `type` field widens from `'website' | 'article'` to `'website' | 'article' | 'profile'`, plus two new optional fields: `profileUsername?: string` (read when `type: 'profile'`) and `article?: { publishedTime: string; author?: string }` (read when `type: 'article'`).
- Consumes: Next's `OpenGraphProfile`/`OpenGraphArticle` types (`node_modules/next/dist/lib/metadata/types/opengraph-types.d.ts`) — `profile.username` is a direct field (not nested), `article.publishedTime`/`article.authors` likewise.

Confirmed via direct inspection of `node_modules/next/dist/lib/metadata/types/opengraph-types.d.ts`: `locale`/`alternateLocale` live on the shared `OpenGraphMetadata` base (valid for every type), `OpenGraphProfile` has a flat `username` field, `OpenGraphArticle` has `publishedTime`/`authors`. No `'product'` type exists — see the Global Constraints note.

- [ ] **Step 1: Write the failing tests**

Append to `lib/seo/metadata.test.ts`:

```ts
  it('sets openGraph.locale and alternateLocale for every other locale', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/x', locale: 'fr' })
    expect(result.openGraph?.locale).toBe('fr_FR')
    expect(result.openGraph?.alternateLocale).toEqual(['en_NG', 'pcm_NG'])
  })

  it('sets profile.username when type is profile', () => {
    const result = buildMetadata({
      title: 'T', description: 'D', path: '/players/sentinel', locale: 'en',
      type: 'profile', profileUsername: 'sentinel',
    })
    expect(result.openGraph).toMatchObject({ type: 'profile', username: 'sentinel' })
  })

  it('sets article publishedTime and authors when type is article', () => {
    const result = buildMetadata({
      title: 'T', description: 'D', path: '/community/123', locale: 'en',
      type: 'article', article: { publishedTime: '2026-09-01T00:00:00.000Z', author: 'Sentinel' },
    })
    expect(result.openGraph).toMatchObject({
      type: 'article',
      publishedTime: '2026-09-01T00:00:00.000Z',
      authors: ['Sentinel'],
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/seo/metadata.test.ts`
Expected: FAIL — `openGraph.locale` is `undefined`; `type: 'profile'`/`'article'` produce no `username`/`publishedTime` fields since `buildMetadata` doesn't accept `profileUsername`/`article` yet.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/seo/metadata.ts`:

```ts
import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME } from './site'
import { LOCALES } from '@/i18n/locales'
import { withLocalePrefix } from '@/lib/i18n/locale-path'
import type { Locale } from '@/i18n/locales'

export type BuildMetadataInput = {
  title: string
  description: string
  /** Route path with no query string, e.g. '/tournaments/dls-26-championship'. */
  path: string
  locale: Locale
  image?: string
  type?: 'website' | 'article' | 'profile'
  /** Required when type is 'profile'. */
  profileUsername?: string
  /** Required when type is 'article'. */
  article?: { publishedTime: string; author?: string }
}

// Facebook/Open-Graph locale tags are xx_YY, not bare BCP-47 codes. There is
// no standard tag for Nigerian Pidgin (pcm), so it's mapped to the same _NG
// region as English rather than left out — still a meaningful signal that
// this is Nigerian content, which is the part that matters here.
const OG_LOCALE: Record<Locale, string> = { en: 'en_NG', fr: 'fr_FR', pcm: 'pcm_NG' }

// `image` is omitted from openGraph/twitter when not given (rather than defaulting
// to a constant) so Next's own opengraph-image.tsx file-convention resolution can
// fill it in — a segment's own dynamic image, falling back to the root default.
// An explicit `image` (e.g. a tournament banner) always overrides that cascade.
export function buildMetadata({
  title,
  description,
  path,
  locale,
  image,
  type = 'website',
  profileUsername,
  article,
}: BuildMetadataInput): Metadata {
  const url = `${SITE_URL}${withLocalePrefix(path, locale)}`
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}${withLocalePrefix(path, l)}`]),
  )
  languages['x-default'] = `${SITE_URL}${path}`

  const openGraphBase = {
    title,
    description,
    url,
    siteName: SITE_NAME,
    locale: OG_LOCALE[locale],
    alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    ...(image ? { images: [image] } : {}),
  }

  const openGraph =
    type === 'profile'
      ? { ...openGraphBase, type: 'profile' as const, ...(profileUsername ? { username: profileUsername } : {}) }
      : type === 'article'
        ? {
            ...openGraphBase,
            type: 'article' as const,
            ...(article ? { publishedTime: article.publishedTime, ...(article.author ? { authors: [article.author] } : {}) } : {}),
          }
        : { ...openGraphBase, type: 'website' as const }

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph,
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/seo/metadata.test.ts`
Expected: PASS (all 5 tests — the 2 pre-existing plus the 3 new ones).

- [ ] **Step 5: Wire `type: 'profile'` into the player page**

In `app/[locale]/(public)/players/[username]/page.tsx`, change the `generateMetadata` return (around line 147):

```ts
  return buildMetadata({ title, description, path: `/players/${p.username}`, locale: params.locale })
```

to:

```ts
  return buildMetadata({
    title,
    description,
    path: `/players/${p.username}`,
    locale: params.locale,
    type: 'profile',
    profileUsername: p.username,
  })
```

- [ ] **Step 6: Wire `type: 'article'` into the community post page**

In `app/[locale]/(public)/community/[postId]/page.tsx`, the `generateMetadata` function currently loads `{ post }` via `fetchPostDetail(params.postId, null)`. `PostView` (from `lib/community/feed-query.ts`) carries `createdAt: string` and `author: PlayerRef` (`{ username, displayName, ... }`). Change:

```ts
export async function generateMetadata({ params }: { params: { postId: string; locale: Locale } }): Promise<Metadata> {
  const { post } = (await fetchPostDetail(params.postId, null)) ?? {}
  return buildMetadata({
    title: post ? `${post.content.slice(0, 80)} — Sentinel X Community` : 'Community Post — Sentinel X',
    description: post?.content.slice(0, 160) ?? 'A post from the SentinelX community feed.',
    path: `/community/${params.postId}`,
    locale: params.locale,
  })
}
```

to:

```ts
export async function generateMetadata({ params }: { params: { postId: string; locale: Locale } }): Promise<Metadata> {
  const { post } = (await fetchPostDetail(params.postId, null)) ?? {}
  return buildMetadata({
    title: post ? `${post.content.slice(0, 80)} — Sentinel X Community` : 'Community Post — Sentinel X',
    description: post?.content.slice(0, 160) ?? 'A post from the SentinelX community feed.',
    path: `/community/${params.postId}`,
    locale: params.locale,
    ...(post
      ? {
          type: 'article' as const,
          article: { publishedTime: post.createdAt, author: post.author.displayName ?? post.author.username ?? undefined },
        }
      : {}),
  })
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/seo/metadata.ts lib/seo/metadata.test.ts "app/[locale]/(public)/players/[username]/page.tsx" "app/[locale]/(public)/community/[postId]/page.tsx"
git commit -m "feat(seo): add og:locale, og:profile, and og:article typing to buildMetadata"
```

---

### Task 6: `generateMetadata` for `exchange/new` and `exchange/requests/new`

**Files:**
- Modify: `app/[locale]/(public)/exchange/new/page.tsx`
- Modify: `app/[locale]/(public)/exchange/requests/new/page.tsx`

Both pages currently export a static `metadata: Metadata` object with only a `title` — no canonical, no hreflang, no OG. Both `redirect()` to `/login` for a logged-out visitor, so this isn't an indexability gap (a crawler never sees the form), but it's still the one inconsistency against "every page uses `buildMetadata()`" (CLAUDE.md's stated SEO rule), and it matters when a logged-in user shares the link (e.g. on WhatsApp) — right now that share gets no OG card at all.

**Interfaces:**
- Consumes: `buildMetadata()` from `lib/seo/metadata.ts` (existing), `Locale` from `i18n/locales.ts` (existing).

- [ ] **Step 1: Convert `exchange/new`**

In `app/[locale]/(public)/exchange/new/page.tsx`, replace:

```ts
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ListingForm } from '@/components/exchange/ListingForm'

export const metadata: Metadata = { title: 'Sell an item — Gaming Exchange' }
```

with:

```ts
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ListingForm } from '@/components/exchange/ListingForm'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params
  return buildMetadata({
    title: 'Sell an item — Gaming Exchange',
    description: 'List a gaming account, coins, or gear on the Sentinel X Gaming Exchange.',
    path: '/exchange/new',
    locale,
  })
}
```

- [ ] **Step 2: Convert `exchange/requests/new`**

In `app/[locale]/(public)/exchange/requests/new/page.tsx`, replace:

```ts
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestForm } from '@/components/exchange/BuyRequestForm'

export const metadata: Metadata = { title: 'Request an item — Gaming Exchange' }
```

with:

```ts
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestForm } from '@/components/exchange/BuyRequestForm'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params
  return buildMetadata({
    title: 'Request an item — Gaming Exchange',
    description: "Tell Sentinel X what you're looking for on the Gaming Exchange.",
    path: '/exchange/requests/new',
    locale,
  })
}
```

- [ ] **Step 3: Verify both pages still redirect logged-out visitors and render for logged-in ones**

Run the dev server, visit `/exchange/new` and `/exchange/requests/new` logged out — confirm redirect to `/login?next=...` still happens (unchanged behavior, only metadata changed).

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/exchange/new/page.tsx" "app/[locale]/(public)/exchange/requests/new/page.tsx"
git commit -m "feat(seo): use buildMetadata on exchange/new and exchange/requests/new"
```

---

### Task 7: Dynamic `/tv` description + its own OG image

**Files:**
- Create: `lib/seo/tv-description.ts`
- Test: `lib/seo/tv-description.test.ts`
- Create: `app/[locale]/(public)/tv/opengraph-image.tsx`
- Modify: `app/[locale]/(public)/tv/page.tsx`

**Interfaces:**
- Produces: `tvDescription(liveMatchTitle: string | null): string` — same shape as the existing `homepageDescription(liveTournamentTitle: string | null): string` in `lib/seo/homepage-description.ts`.

`/tv`'s metadata is currently static even though the homepage already has a proven pattern (`homepageDescription()`) for naming what's live right now. `/tv`'s page body already queries the live match (`live[0]`, `app/[locale]/(public)/tv/page.tsx:126`) but `generateMetadata` runs independently and needs its own (lighter) query.

- [ ] **Step 1: Write the failing test**

```ts
// lib/seo/tv-description.test.ts
import { describe, it, expect } from 'vitest'
import { tvDescription } from './tv-description'

describe('tvDescription', () => {
  it('falls back to the static description when nothing is live', () => {
    expect(tvDescription(null)).toBe(
      'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.',
    )
  })

  it('mentions the live match by name when one is streaming', () => {
    const result = tvDescription('Sentinel vs Chuka')
    expect(result).toContain('Sentinel vs Chuka')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/seo/tv-description.test.ts`
Expected: FAIL — `Cannot find module './tv-description'`.

- [ ] **Step 3: Implement**

```ts
// lib/seo/tv-description.ts
export function tvDescription(liveMatchTitle: string | null): string {
  if (!liveMatchTitle) {
    return 'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.'
  }
  return `${liveMatchTitle} is live now on Sentinel X TV — plus highlights, finals, and replays.`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/seo/tv-description.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `/tv`'s own OG image**

```tsx
// app/[locale]/(public)/tv/opengraph-image.tsx
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderOgImage({ title: 'Sentinel X TV', subtitle: 'Live, Highlights & Replays' })
}
```

- [ ] **Step 6: Wire the dynamic description into `generateMetadata` and drop the now-redundant explicit image**

In `app/[locale]/(public)/tv/page.tsx`, replace:

```ts
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildVideoJsonLd } from '@/lib/seo/schema/video'
import { parseYouTubeId } from '@/lib/matches/youtube'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Sentinel X TV — Live, Highlights & Replays',
    description: 'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.',
    path: '/tv',
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}
```

with:

```ts
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildVideoJsonLd } from '@/lib/seo/schema/video'
import { parseYouTubeId } from '@/lib/matches/youtube'
import { tvDescription } from '@/lib/seo/tv-description'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const supabase = createClient()
  const { data: liveMatch } = await supabase
    .from('matches')
    .select(
      'player_a:profiles!matches_player_a_id_fkey(username, display_name), player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('status', 'live')
    .not('youtube_stream_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const liveTitle = liveMatch ? `${nameOf(liveMatch.player_a)} vs ${nameOf(liveMatch.player_b)}` : null

  return buildMetadata({
    title: 'Sentinel X TV — Live, Highlights & Replays',
    description: tvDescription(liveTitle),
    path: '/tv',
    locale,
  })
}
```

`nameOf` and `NameRef` are already defined lower in this same file (`app/[locale]/(public)/tv/page.tsx:33-40`) — `generateMetadata` can reference them since they're plain module-level functions, but since `generateMetadata` in this file is placed *before* those declarations, hoisting only works for `function` declarations (which `nameOf` already is), so no reordering is needed.

- [ ] **Step 7: Run the full test suite for this file's directory**

Run: `npx vitest run lib/seo/`
Expected: PASS — all `lib/seo/*.test.ts` files green.

- [ ] **Step 8: Commit**

```bash
git add lib/seo/tv-description.ts lib/seo/tv-description.test.ts "app/[locale]/(public)/tv/opengraph-image.tsx" "app/[locale]/(public)/tv/page.tsx"
git commit -m "feat(seo): dynamic /tv description naming the live match + dedicated OG image"
```

---

### Task 8: Per-section OG images for the remaining public pages

**Files:**
- Create: `app/[locale]/(public)/rankings/opengraph-image.tsx`
- Create: `app/[locale]/(public)/hall-of-fame/opengraph-image.tsx`
- Create: `app/[locale]/(public)/games/opengraph-image.tsx`
- Create: `app/[locale]/store/opengraph-image.tsx`
- Create: `app/[locale]/(public)/about/opengraph-image.tsx`
- Create: `app/[locale]/(public)/community/opengraph-image.tsx`
- Create: `app/[locale]/(public)/privacy/opengraph-image.tsx`
- Create: `app/[locale]/(public)/terms/opengraph-image.tsx`
- Create: `app/[locale]/(public)/refund-policy/opengraph-image.tsx`
- Create: `app/[locale]/(public)/rules/opengraph-image.tsx`
- Create: `app/[locale]/(public)/safety/opengraph-image.tsx`
- Create: `app/[locale]/(public)/escrow/opengraph-image.tsx`
- Create: `app/[locale]/(public)/community-rules/opengraph-image.tsx`
- Create: `app/[locale]/(public)/how-it-works/opengraph-image.tsx`
- Create: `app/[locale]/(public)/help/opengraph-image.tsx`
- Create: `app/[locale]/(public)/contact/opengraph-image.tsx`
- Create: `app/[locale]/(public)/tournament-guide/opengraph-image.tsx`
- Create: `app/[locale]/(public)/tournament-faqs/opengraph-image.tsx`
- Modify: `app/[locale]/(public)/rankings/page.tsx`
- Modify: `app/[locale]/(public)/hall-of-fame/page.tsx`
- Modify: `app/[locale]/(public)/games/page.tsx`
- Modify: `app/[locale]/(public)/about/page.tsx`
- Modify: `app/[locale]/(public)/community/page.tsx`

(`/tv` already done in Task 7. `/store` and every legal/static page below have no explicit `image:` param today, so no page-file edit is needed for them — adding the `opengraph-image.tsx` file is enough for Next's cascade to pick it up.)

**Interfaces:**
- Consumes: `renderOgImage({ title, subtitle? })` and `OG_SIZE` from `lib/og/template.tsx` (existing, unchanged).

- [ ] **Step 1: Create all 18 new `opengraph-image.tsx` files**

Every file follows the exact same shape as the existing `app/opengraph-image.tsx`:

```tsx
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderOgImage({ title: '<TITLE>' })
}
```

Create each file with its `<TITLE>` from this table (titles taken from each page's own `generateMetadata`/i18n `metaTitle`, with the `— Sentinel X` / `· SentinelX Esports` suffix dropped since `renderOgImage` already renders the "SENTINEL X" wordmark above the title):

| File | `<TITLE>` |
|---|---|
| `app/[locale]/(public)/rankings/opengraph-image.tsx` | `Leaderboards` |
| `app/[locale]/(public)/hall-of-fame/opengraph-image.tsx` | `Hall of Fame` |
| `app/[locale]/(public)/games/opengraph-image.tsx` | `Games` |
| `app/[locale]/store/opengraph-image.tsx` | `Store` |
| `app/[locale]/(public)/about/opengraph-image.tsx` | `About Us` |
| `app/[locale]/(public)/community/opengraph-image.tsx` | `Community` |
| `app/[locale]/(public)/privacy/opengraph-image.tsx` | `Privacy Policy` |
| `app/[locale]/(public)/terms/opengraph-image.tsx` | `Terms of Service` |
| `app/[locale]/(public)/refund-policy/opengraph-image.tsx` | `Refund Policy` |
| `app/[locale]/(public)/rules/opengraph-image.tsx` | `Tournament Rules` |
| `app/[locale]/(public)/safety/opengraph-image.tsx` | `Stay Safe on SentinelX` |
| `app/[locale]/(public)/escrow/opengraph-image.tsx` | `Safe Trading with Zolarux Escrow` |
| `app/[locale]/(public)/community-rules/opengraph-image.tsx` | `Community Rules` |
| `app/[locale]/(public)/how-it-works/opengraph-image.tsx` | `How SentinelX Works` |
| `app/[locale]/(public)/help/opengraph-image.tsx` | `Help Center` |
| `app/[locale]/(public)/contact/opengraph-image.tsx` | `Contact Us` |
| `app/[locale]/(public)/tournament-guide/opengraph-image.tsx` | `Tournament Guide` |
| `app/[locale]/(public)/tournament-faqs/opengraph-image.tsx` | `Tournament FAQs` |

- [ ] **Step 2: Remove the now-redundant explicit `image: DEFAULT_OG_IMAGE` overrides**

Five files pass `image: DEFAULT_OG_IMAGE` explicitly in `buildMetadata()`, which (per the comment in `lib/seo/metadata.ts`) bypasses Next's file-convention cascade — so their brand-new `opengraph-image.tsx` from Step 1 would otherwise never be used. In each of the five files below, delete the `image: DEFAULT_OG_IMAGE,` line from the `buildMetadata({...})` call, and delete the now-unused `import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'` line (confirmed to be the only use of that import in each file).

- `app/[locale]/(public)/rankings/page.tsx` (remove line with `image: DEFAULT_OG_IMAGE,` inside the `generateMetadata` at the top of the file, and the corresponding import)
- `app/[locale]/(public)/hall-of-fame/page.tsx` (same)
- `app/[locale]/(public)/games/page.tsx` (same)
- `app/[locale]/(public)/about/page.tsx` (same)
- `app/[locale]/(public)/community/page.tsx` (same)

(`/store` needs no edit — it never passed an explicit `image` and already cascades.)

- [ ] **Step 3: Verify a sample of the new images render**

Run the dev server, visit `/rankings/opengraph-image`, `/privacy/opengraph-image`, and `/store/opengraph-image` directly in a browser — each should render a 1200×630 PNG with "SENTINEL X" and the page's title.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/rankings" "app/[locale]/(public)/hall-of-fame" "app/[locale]/(public)/games" "app/[locale]/store" "app/[locale]/(public)/about" "app/[locale]/(public)/community" "app/[locale]/(public)/privacy" "app/[locale]/(public)/terms" "app/[locale]/(public)/refund-policy" "app/[locale]/(public)/rules" "app/[locale]/(public)/safety" "app/[locale]/(public)/escrow" "app/[locale]/(public)/community-rules" "app/[locale]/(public)/how-it-works" "app/[locale]/(public)/help" "app/[locale]/(public)/contact" "app/[locale]/(public)/tournament-guide" "app/[locale]/(public)/tournament-faqs"
git commit -m "feat(seo): dedicated OG image for every remaining public page"
```

---

### Task 9: Expand `llms-full.txt`

**Files:**
- Create: `public/llms-full.txt`

**Interfaces:** None — a static text file, served as-is by Next's `public/` convention. No route wiring needed (same as the existing `public/llms.txt`).

The existing `public/llms.txt` is a concise summary (per the llms.txt spec convention: short file + optional `llms-full.txt` for depth). This adds the fuller companion with concrete detail an answer engine would actually quote — the four pillars, the SX Score tier table, supported games, tournament grouping rules, and payments/KYC basics — all copied from CLAUDE.md's own documented rules (`CLAUDE.md`, "SX Score System" and "Tournament Logic" and "Payments — Paystack" sections) so it stays accurate to what's actually implemented rather than aspirational.

- [ ] **Step 1: Write `public/llms-full.txt`**

```
# Sentinel X — Full Reference

> Nigeria's Home of Mobile Esports — where gamers compete, connect, and transact safely.

Sentinel X is a mobile esports platform for Nigeria, built to support multiple mobile
games (currently live: Dream League Soccer and EA FC Mobile, alongside Free Fire and
PUBG Mobile tournament formats) without rebuilding the platform per game. Tournaments,
rankings, and profiles are all multi-game by design.

## The four pillars

- Compete — Tournaments, brackets, and matches. Players register and pay an entry fee
  through Paystack; once registration closes, the platform auto-calculates groups
  (straight knockout for 8 or fewer entrants, otherwise 2/4/8 groups of 4-8 players
  depending on entrant count, top 2 per group advancing) and then runs single
  elimination. Match results are submitted by the winner (screenshot + screen
  recording) and confirmed by an admin before any bracket or standing updates —
  nothing updates automatically from a player's own submission.
- Watch — Sentinel X TV: live streams (players stream to the Sentinel X YouTube
  channel), highlights, finals, and replays, embedded directly on Match Centre pages.
- Community — Posts, discussions, and announcements from Nigerian mobile esports
  players.
- Trade — The Gaming Exchange: buying and selling gaming accounts, coins, and gear,
  protected by Zolarux escrow.

## Key pages

- /tournaments — browse live, open, and upcoming tournaments
- /tournaments/{slug} — a tournament's prize pool, format, and registration
- /tournaments/{slug}/bracket — the interactive bracket
- /matches/{id} — Match Centre: live stream, replay, and stats for one match
- /rankings — the Sentinel X leaderboard, overall and per-game
- /hall-of-fame — season champions, MVP, Golden Boot, Best Goal
- /tv — live streams, highlights, finals, and replays
- /exchange — the Gaming Exchange marketplace
- /store — spend SX Coins on avatar borders, profile themes, username colours, and
  mascot skins
- /community — player discussions and announcements
- /players/{username} — a player's stats, achievements, SX Score, and match history
- /seasons/{slug} — a season's tournaments and leaderboards across every game
- /about — the Sentinel X story, mission, and partners

## Player reputation: SX Score

Every player starts at 700. There is no upper cap; the score is floored at 0.

Points earned: completing a match (+10), winning without a dispute (+90, stacking
with completion for +100 total on a clean win), a 5-star opponent rating (+20), a
4-star rating (+10).

Points lost: a no-show (-100), abandoning/rage-quitting (-80), losing a dispute over
a false result (-150), a 1-2 star rating (-20), an admin conduct flag (-50), an admin
cheating flag (-200 plus suspension).

Tiers shown on a player's profile:
- 900 and above — Elite
- 750-899 — Trusted
- 600-749 — Developing
- below 600 — At Risk

## Tournaments and payments

- Registration fee: 500 Naira per tournament, paid via Paystack at registration.
- Prize withdrawal: players request a payout from their Dashboard once their bank
  account is Paystack-verified; payouts are currently processed manually by a Sentinel
  X admin (Paystack's Transfer API is not yet enabled for the account).
- KYC for withdrawals is payout-account-only today — BVN identification is disabled
  because most competitive players are minors without a BVN and Paystack's
  identification API has no NIN alternative yet.

## Contact

Sentinel X is based in Nigeria. A link to the Sentinel X WhatsApp community is in the
site header, and every tournament, match, and bracket page has a "Share on WhatsApp"
button.
```

- [ ] **Step 2: Verify it's served**

Run the dev server, visit `/llms-full.txt` — confirm the raw text renders (same as `/llms.txt` already does).

- [ ] **Step 3: Commit**

```bash
git add public/llms-full.txt
git commit -m "feat(seo): add llms-full.txt with fuller AEO reference content"
```

---

### Task 10: Remove empty leftover i18n-migration directories

**Files:**
- Delete: `app/(public)/` (confirmed empty — zero files, leftover from the i18n migration that moved routes under `app/[locale]/`)
- Delete: `app/(auth)/` (same)

**Interfaces:** None — these directories contain no files today; deleting them changes no routes or behavior.

- [ ] **Step 1: Confirm both directories are actually empty before deleting**

Run: `find "app/(public)" "app/(auth)" -type f 2>&1`
Expected: no output (no files found in either directory). If this prints any file paths, STOP this task and report back rather than deleting — the survey that found these empty may be stale.

- [ ] **Step 2: Remove them**

```bash
git rm -r --ignore-unmatch "app/(public)" "app/(auth)"
```

(If `git rm` reports nothing to remove because git was never tracking empty directories, that's expected — just delete them directly if they exist on disk: `rm -rf "app/(public)" "app/(auth)"`.)

- [ ] **Step 3: Confirm the app still builds**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20`
Expected: no new errors compared to before this task (these directories had no files, so nothing should change).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove empty leftover app/(public) and app/(auth) directories"
```

---

## Final verification (after all 10 tasks)

- [ ] Run the full test suite: `npx vitest run`
- [ ] Expected: PASS, including all `lib/seo/*.test.ts` files (existing + the 2 new ones from Tasks 4 and 7, plus the 3 new cases added to `lib/seo/metadata.test.ts` in Task 5).
- [ ] Run a full type-check: `npx tsc --noEmit -p tsconfig.json`
- [ ] Expected: no errors.
