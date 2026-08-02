# Design: Shareable match cards

**Date:** 2026-08-02
**Context:** Match pages currently generate a bare OG meta image (dark background, player names + score, no branding) via `lib/og/template.tsx` — used only passively, when a link is pasted somewhere. There's no image a player would actively want to grab and post to their own WhatsApp Status/Instagram/Twitter.

## Background — what already exists

- `lib/og/template.tsx`: `renderOgImage({ title, subtitle })` — a single generic `next/og` `ImageResponse` template (1200x630), used by every `opengraph-image.tsx` across the site (tournaments, players, matches, exchange listings, home).
- `app/(public)/matches/[id]/opengraph-image.tsx`: fetches `score_a`, `score_b`, `status`, and both players' names, renders `"${a} vs ${b}"` / `"${scoreA} – ${scoreB}"` via the shared template. No avatars, no tournament name, no win/loss framing.
- `profiles.avatar_url` exists (nullable) — not currently used by the OG template.
- Existing WhatsApp share is text-only (`wa.me/?text=`), no image attachment — that's a hard limitation of the `wa.me` link format, not something this feature replaces.

## What's changing

### Render function: two variants instead of one

`lib/og/match-card.tsx` (new, sits alongside `template.tsx`) exports:

```ts
export function renderMatchCard(input: HypeCardInput | ResultCardInput) // dispatches on input.variant
```

- **Hype card** (`variant: 'hype'`) — shown when `match.status === 'scheduled'`: both players' avatar (or initials fallback if `avatar_url` is null) and gamertag side by side with "VS" between them, tournament title, formatted scheduled time (WAT), Sentinel X branding.
- **Result card** (`variant: 'result'`) — shown when `match.status === 'completed'`: same layout, but the winner's side is visually emphasized (highlighted border/background + a "WINNER" tag) and the final score is prominent. Draws (group-stage) show both scores without a winner emphasis.
- Matches in any other status (`live`, `disputed`, `cancelled`, `forfeited`) fall back to the hype card layout without a "WINNER" tag — there's no result worth showing yet, and the alternative (erroring) would break the existing passive OG-image use case for those statuses today.

Avatar images are fetched server-side (`next/og` requires images as accessible URLs or data — Supabase Storage public URLs work directly, same as any other `<img>` in an `ImageResponse` tree). No new avatar-fetching logic beyond passing `avatar_url` through.

### One render path, two consumers

`app/(public)/matches/[id]/opengraph-image.tsx` is rewritten to call `renderMatchCard` instead of `renderOgImage`, picking the variant from `match.status` — this is what a pasted link shows.

`app/api/matches/[id]/card/route.ts` (new) — same query + same `renderMatchCard` call, returned as a downloadable PNG response (`Content-Disposition: attachment` is *not* set, since the Share button's `fetch()` needs to read it as a blob, not trigger a browser download prompt). This is the endpoint the on-page Share button hits. Both routes share the data-fetching logic via a small `lib/og/match-card-data.ts` helper (`loadMatchCardInput(supabase, matchId): Promise<HypeCardInput | ResultCardInput | null>`) so the query/mapping isn't duplicated.

### Share button

`components/match/ShareCardButton.tsx` (new client component), placed on `app/(public)/matches/[id]/page.tsx` near the existing "Share on WhatsApp" text link (that link is untouched):

```ts
async function handleShare() {
  const res = await fetch(`/api/matches/${matchId}/card`)
  const blob = await res.blob()
  const file = new File([blob], 'sentinel-x-match.png', { type: 'image/png' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Sentinel X', text: shareText })
  } else {
    // fallback: trigger a download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sentinel-x-match.png'
    a.click()
    URL.revokeObjectURL(url)
  }
}
```

- `navigator.canShare({ files: [...] })` is checked, not just `navigator.share` — Safari/some browsers expose `share()` without file support, and calling it with files there throws.
- The fallback path (desktop, or a mobile browser without file-share support) downloads the PNG directly — no separate "Download" button needed, one button covers both paths per the earlier decision.

## Testing

- `lib/og/match-card-data.test.ts` (if data-mapping has any branching worth testing) — variant selection (`scheduled` → hype, `completed` → result, everything else → hype-without-winner), and the avatar-fallback-to-initials path.
- No meaningful unit test for the `ImageResponse` JSX itself (visual, not logic) — verified manually by loading `/api/matches/[id]/card` for a scheduled and a completed match in a browser.
