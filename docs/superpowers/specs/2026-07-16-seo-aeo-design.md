# SEO & AEO — Design Spec

**Date:** 2026-07-16
**Status:** Approved design → ready for implementation plan
**Scope:** Site-wide technical SEO (Google/Bing) and AEO (AI answer engines — ChatGPT, Perplexity, Google AI Overviews) foundation, plus per-entity structured data. No new pages except the OG image render routes.

---

## 1. Goal

Sentinel X has organically grown `generateMetadata` on several detail pages (tournaments, players, matches, exchange) but has no sitemap, no `robots.ts`, no root-level metadata defaults (`metadataBase`, Twitter cards, OG fallback image), and the **homepage itself has no metadata at all**. Structured data (JSON-LD) exists on exactly one page (player profiles). This spec closes those gaps in one pass and establishes shared infrastructure so future pages inherit good SEO/AEO defaults instead of hand-rolling metadata objects.

Production is currently served from the Vercel subdomain (`sentinelxesports.vercel.app`); the custom domain `sentinelx.gg` is not yet connected. Everything here is built against `NEXT_PUBLIC_SITE_URL` so it's correct on whichever domain is live — but note that submitting to Google Search Console and expecting indexing to "count" should wait until the custom domain is live, since URLs indexed under the `.vercel.app` host don't carry over.

## 2. Shared SEO infrastructure

### `lib/seo/site.ts`
Single source of truth, replacing the ~20 duplicated `const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'` lines across the codebase:

```ts
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
export const SITE_NAME = 'SentinelX Esports'       // full form, used in OG/JSON-LD
export const SITE_SHORT_NAME = 'SentinelX'          // shorthand, title-template only
export const SITE_TAGLINE = "Nigeria's Home of Mobile Esports"
export const SITE_DESCRIPTION = "Nigeria's Home of Mobile Esports — Where Gamers Unite. Champions Rise."
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`
```

All existing per-file `SITE_URL` constants get replaced with an import from here. `siteName` usage is normalized to `SITE_NAME` everywhere (currently inconsistent between `'Sentinel X'` and `'SentinelX Esports'`).

### `lib/seo/metadata.ts`
```ts
buildMetadata({ title, description, path, image?, type? }): Metadata
```
Returns a consistent `Metadata` object: title, description, `alternates.canonical` (`${SITE_URL}${path}`), `openGraph` (title, description, url, siteName, type, images: `[image ?? DEFAULT_OG_IMAGE]`), `twitter` (`card: 'summary_large_image'`, title, description, images). Existing hand-rolled OG objects in the detail pages (tournaments, players, matches, exchange) get switched to call this helper — this is what makes Twitter cards, which are currently missing site-wide, show up for free.

### `components/seo/JsonLd.tsx`
```tsx
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}
```
The player profile page already has this exact inline pattern. It gets switched to use the shared component as part of this work for consistency; every new JSON-LD block below uses `<JsonLd>` from day one.

### `app/robots.ts`
Next 14 file convention (`MetadataRoute.Robots`). Disallow: `/admin`, `/dashboard`, `/api`, `/login`, `/signup`, `/forgot-password`, `/reset-password`. Allow everything else. `sitemap: `${SITE_URL}/sitemap.xml``.

### `app/sitemap.ts`
Next 14 file convention (`MetadataRoute.Sitemap`). Static entries: `/`, `/tournaments`, `/players`, `/rankings`, `/hall-of-fame`, `/tv`, `/exchange`, `/community`. Dynamic entries, queried with **`createAdminClient()`** (service role) — sitemap generation has no authenticated user, so the RLS-scoped `createClient()` would silently return zero rows for every table and ship an empty sitemap with no visible error:
- Tournaments: `status != 'draft'` → `/tournaments/[slug]`
- Players: profiles with `total_matches > 0` → `/players/[username]`
- Matches: `status = 'completed'` → `/matches/[id]` (this route is confirmed public — no auth redirect, just an optional ownership check for the result-submission form — so it's safe to index)
- Exchange listings: `status = 'active'` → `/exchange/[id]`

### Icons
`app/favicon.ico` and `app/apple-icon.png` generated from the existing `public/logo-icon.png` (resized, no new brand asset). Next's file convention wires these in automatically.

### `public/og-default.png`
A static 1200×630 branded fallback image (logo + tagline on brand background), used as `DEFAULT_OG_IMAGE` by `buildMetadata` for any page without its own banner/avatar/photo. This is the WhatsApp-share fallback — without it, pages relying on the default show a blank link-preview card.

## 3. Page-level metadata fixes

- **Homepage (`app/page.tsx`)** — currently has no metadata export at all. Add `generateMetadata` (dynamic, since it can reference the current live/open tournament by name) built via `buildMetadata`. Fallback description when no tournament is live/open is the static `SITE_DESCRIPTION` constant — never an empty string.
- **Noindex private routes** — `/admin/**`, `/dashboard/**`, and the four auth pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`) get `robots: { index: false, follow: false }` in their metadata. This is belt-and-suspenders alongside `robots.txt`: the disallow stops crawling, the noindex meta stops indexing if a URL is discovered another way (e.g. someone pastes a dashboard link publicly).
- **Canonical URLs for filtered listings** — `/tournaments`, `/players`, `/exchange` accept filter/sort query params (confirmed: `exchange?category=`). Their metadata's `alternates.canonical` strips only an **explicit allowlist of filter/sort params** (`category`, `status`, `q`) and points at the bare path. This is NOT a blanket "strip all query strings" — if pagination (`?page=`) is added later, `page` must never be in the strip list, or paginated listing pages would get canonicalized into page 1 and Google would stop indexing pages 2+. No pagination exists today, so this is a forward-looking constraint on the implementation, not a feature to build now.

## 4. Structured data (JSON-LD)

- **Root layout** — `Organization` (name, url, logo) + `WebSite` (name, url) schema, present on every page via `<JsonLd>`.
- **Tournament detail (`/tournaments/[slug]`)** — `SportsEvent`: name, description, `startDate` (`tournament_start`), `endDate` (`tournament_end`) **only when set — never duplicate `startDate` into `endDate`**, `eventStatus` (mapped from tournament status), `eventAttendanceMode: OnlineEventAttendanceMode`, `location: { @type: VirtualLocation, url }`, `organizer` (Organization), `offers` (`registration_fee` as NGN price, `availability` derived from registration status).
- **Match detail (`/matches/[id]`)** — lightweight `SportsEvent` sub-event: name (`"{Player A} vs {Player B}"`), `competitor` (two `Person` entries), `superEvent` referencing the parent tournament, final score when completed.
- **Player profile (`/players/[username]`)** — extend the existing `Person` schema, moving it to `<JsonLd>`. Quantified facts (wins, Sentinel Score tier) go into the `description` field as plain text, **not** `interactionStatistic` (that property is for page-level interaction counts like views/follows, not player stats — using it for stats would be a schema.org misapplication).
- **Exchange listing (`/exchange/[id]`)** — `Product`: name, description, image, `offers` (price in NGN, `availability` from listing status), `seller: Organization` (Sentinel X, not the individual — correct given escrow mediates the transaction and avoids exposing sellers as public schema.org identities).
- **TV page (`/tv`)** — `VideoObject` per video card (curated + match-derived). All four Google-required fields present: `name`, `description` (fallback: `"Match recording — {tournament name}"` when a curated video has none), `thumbnailUrl` (existing `youtubeThumbnail` helper), `uploadDate`.
- **BreadcrumbList** — added on nested detail routes: `tournaments/[slug]`, `tournaments/[slug]/bracket`, `players/[username]`, `exchange/[id]`.

## 5. AEO — dynamic OG images

`lib/og/template.tsx` — shared render function (brand background, logo, title, subtitle) using Next's `ImageResponse` (`next/og`). **Font note:** `next/font` fonts are not usable inside `ImageResponse` — the template must `fetch()` a font file explicitly at render time. Since `app/fonts/GeistVF.woff` is already a local static asset, that's what the template fetches (no new font dependency, no Google Fonts CDN round-trip).

Each dynamic detail route gets a thin `opengraph-image.tsx` (Next 14 file convention — auto-wired into that route segment's metadata, no manual `openGraph.images` wiring needed) that fetches its own data and calls the shared template:
- `tournaments/[slug]/opengraph-image.tsx` — tournament title + prize pool
- `players/[username]/opengraph-image.tsx` — display name + Sentinel Score tier
- `matches/[id]/opengraph-image.tsx` — player A vs player B + score if completed
- `exchange/[id]/opengraph-image.tsx` — listing title + price

Static pages (home, rankings, hall-of-fame, tv, community) use the static `DEFAULT_OG_IMAGE` from §2 — no per-page variable content worth rendering dynamically.

## 6. AEO — llms.txt and homepage FAQ

### `public/llms.txt`
Plain-markdown file at the site root (emerging convention checked by AI crawlers/agents). Describes: what Sentinel X is, the four pillars (Compete/Watch/Community/Trade), how tournaments work (registration → auto-grouping → knockout → admin-verified results), Sentinel Score basics, key public routes. **Scope constraint: visitor-facing content only.** No internal architecture, no admin routes, no library/vendor names (Supabase, Paystack, Termii, etc.), no engineering conventions — CLAUDE.md mixes those in and this file must not. Drafted from CLAUDE.md's platform description, filtered through that constraint, and reviewed by the user before it ships since it's public copy representing the platform to AI systems.

### Homepage FAQ block
5–6 Q&As rendered below the fold on the homepage using native `<details>/<summary>` (or plain always-in-DOM markup) — **not** a JS-driven accordion that hides content before hydration, since Google requires FAQPage answer text to be present in the DOM at load to validate the rich result. Questions: what is Sentinel X, how do I join a tournament, how much does it cost to register, how are match results verified, how do I withdraw prize money, is it free to browse/watch. Paired with `FAQPage` JSON-LD (`mainEntity: Question[]` with `acceptedAnswer.text` matching the visible copy exactly).

## 7. Out of scope

- Google Search Console / Bing Webmaster Tools submission (manual step, do once `sentinel.gg` is live)
- Backlink building, content marketing
- Per-game landing pages (blocked on #21b multi-game team leagues work)
- A/B testing meta titles/descriptions
