# Design: SEO/AEO audit fixes

**Date:** 2026-08-02
**Context:** General audit of the site's SEO/AEO setup, requested with no specific complaint. The existing setup is already mature — `generateMetadata()` + Open Graph on every public page, JSON-LD (Organization/WebSite globally, plus Event/FAQ/Player/Listing/Video schemas on relevant pages), a homepage FAQ section with matching schema, a dynamic sitemap, and a permissive robots.txt that already allows AI crawlers. This spec covers only the concrete gaps found during the audit — it does not redo any of the above.

## What was checked and found clean (not touched by this spec)

- Metadata coverage: every public page under `app/(public)` already calls `buildMetadata()`.
- `Organization`/`WebSite` JSON-LD: already rendered globally in `app/layout.tsx`.
- Dynamic sitemap entries (tournaments, players, matches, exchange listings): already correct in `lib/seo/sitemap-entries.ts`.
- `robots.ts`: already `userAgent: '*'`, no AI-crawler-specific block.
- FAQ schema: present and rendered (not just structured data) on the homepage.

## 1. Missing `/betting` sitemap entry

`lib/seo/sitemap-entries.ts`'s `staticSitemapEntries()` lists 10 static paths but omits `/betting` (added in the previous session, never wired into the sitemap). One-line fix: add `'/betting'` to the `paths` array.

## 2. Empty `alt=""` on content images that have real text available

Four components render a content-bearing image with `alt=""` while the descriptive text is already sitting in scope, unused:

- `components/exchange/ListingCard.tsx`: `alt=""` → `alt={listing.title}`
- `components/exchange/ImageGallery.tsx` (thumbnail strip only — the main image already correctly uses `alt={title}`): `alt=""` → `alt={`${title} photo ${i + 1}`}`
- `components/tv/VideoCard.tsx`: `alt=""` → `alt={video.title}`
- `components/tv/MatchVideoCard.tsx`: `alt=""` → `alt={video.title}`

**Explicitly not touched:**
- `components/community/PostCard.tsx`'s image grid — no per-image title exists (only free-text post body), and the surrounding `<button aria-label="View image">` already provides an accessible label. Setting `alt` to a truncated post body would be low-value, noisy alt text.
- `components/shared/Avatar.tsx`, `components/home/PromoBanner.tsx` (already has real alt text), and every admin-only component (`ImageUploader`, `BannerRow`, `BannerForm`, `ExchangeQueueRow`, `AdminCommunityPostRow`) — decorative or not public/indexed, out of scope.

## 3. Breadcrumb JSON-LD missing on two nested page types

`buildBreadcrumbJsonLd` (`lib/seo/schema/breadcrumb.ts`) is already used on tournament, bracket, player, and exchange-listing pages, but not on the two other equally-nested public pages:

- `app/(public)/matches/[id]/page.tsx`: the page already fetches `m.tournaments` (title, slug) via `MATCH_SELECT`. Add `[{name: 'Tournaments', path: '/tournaments'}, {name: m.tournaments.title, path: '/tournaments/{slug}'}, {name: '{playerA} vs {playerB}', path: '/matches/{id}'}]` when `m.tournaments` is non-null, omitting the middle tournament level (two-item breadcrumb) on the rare row where it's null.
- `app/(public)/tournaments/[slug]/results/page.tsx`: add breadcrumb `Tournaments → [tournament title] → Results`, matching the pattern already used on the sibling `[slug]/page.tsx` and `[slug]/bracket/page.tsx`.

## 4. `llms.txt`

**Correction (found during implementation, not during this audit):** `public/llms.txt` already existed — the audit that produced this spec checked `app/` route-convention files but missed the `public/` static-assets directory. The existing file is more thorough than what's drafted below. No new route was created; this section is left for the record only.

New route handler `app/llms.txt/route.ts`, matching the existing `robots.ts`/`sitemap.ts` file-convention pattern in this codebase (a `.ts` file under `app/` returning the right content type), returning `text/plain` per the llmstxt.org convention: an H1 with the site name, a one-line blockquote summary, then a `## Pages` section linking the key public surfaces. The H1 and first summary line are built from the existing `SITE_NAME`/`SITE_DESCRIPTION` constants (`lib/seo/site.ts`); the second summary sentence is adapted from the "What is Sentinel X" description already in this repo's `CLAUDE.md` (existing documented positioning, not new copy); the page-link list is new but is just titles + one-line descriptions of pages that already exist.

```
# SentinelX Esports

> Nigeria's Home of Mobile Esports — Where Gamers Unite. Champions Rise.
> A mobile esports platform where players compete in tournaments, watch live
> matches and replays, connect with the community, and trade gaming accounts
> and items safely. Supports Dream League Soccer today, built to grow across
> other mobile games.

## Pages

- [Tournaments](https://sentinelx.gg/tournaments): current, upcoming, and past tournaments with brackets and prize pools
- [Rankings](https://sentinelx.gg/rankings): player leaderboards
- [Hall of Fame](https://sentinelx.gg/hall-of-fame): season champions and award winners
- [Sentinel X TV](https://sentinelx.gg/tv): live streams, replays, and highlights
- [Gaming Exchange](https://sentinelx.gg/exchange): peer-to-peer gaming account and item trading
- [Community](https://sentinelx.gg/community): player posts and discussions
- [About](https://sentinelx.gg/about): platform story and mission
```

Static content (no DB queries) — this is a stable reference document, not a live data feed, consistent with how `llms.txt` is used elsewhere (a durable summary, re-crawled periodically, not real-time).

## Testing

- `lib/seo/sitemap-entries.test.ts` already exists; extend it with a case asserting `/betting` is present in `staticSitemapEntries()`.
- No other item here has meaningful unit-testable logic (alt text and breadcrumb wiring are direct JSX/data-plumbing changes, `llms.txt` is static content) — verified by reading the rendered output directly (dev server + curl) rather than a test.
