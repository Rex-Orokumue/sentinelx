# Sentinel X TV (#11) — Design Spec

**Date:** 2026-07-09
**Status:** Approved design → ready for implementation plan
**Scope:** v2.0 #11 — the `/tv` "Watch" pillar.

---

## 1. Goal

Build `/tv` — Sentinel X TV — a public hub that stitches **two content sources** into one experience: **match-derived** videos (live streams, finals, replays pulled from `matches`) and **curated** clips (a new `tv_videos` table an admin controls). Plus the minimal admin surface to manage curated videos.

Video is **YouTube-embed only** (platform rule — no native hosting). Reuses `parseYouTubeId` / `VideoEmbed` from the match work.

## 2. Data model

### New table `tv_videos` (migration `010_tv_videos.sql`)

| Column | Type / notes |
|---|---|
| `id` | uuid pk, default `gen_random_uuid()` |
| `title` | text not null |
| `description` | text null |
| `youtube_url` | text not null (validated to a real YouTube link in the app layer) |
| `category` | text not null, CHECK in (`highlight`, `interview`, `recap`, `best_goal`) |
| `thumbnail_url` | text null — when null, derived from the YouTube id at render time |
| `published_at` | timestamptz not null default `now()` |
| `created_by` | uuid not null → `profiles(id)` |
| `active` | boolean not null default `true` |

Index on `published_at DESC`. **RLS** (reusing the existing `is_staff()` function):
- `tv_videos_public_read` — `FOR SELECT USING (active OR public.is_staff())`
- `tv_videos_staff_insert` — `FOR INSERT WITH CHECK (public.is_staff())`
- `tv_videos_staff_update` — `FOR UPDATE USING (public.is_staff())`
- `tv_videos_staff_delete` — `FOR DELETE USING (public.is_staff())`

After applying, **regenerate `lib/supabase/types.ts`** so the table is typed.

### Match-derived sources (no schema change)
- **Live** — `matches` `status='live'` with `youtube_stream_url` set.
- **Finals** — `round='final'`, `status='completed'`, `replay_url` set.
- **Replays** — `status='completed'`, `replay_url` set (newest first).

## 3. Public `/tv` page

`app/(public)/tv/page.tsx` (server component, public). Sections in this order, **each hidden when empty**:

1. **Live Now** — if any match is live with a stream: embed the newest as a hero (`VideoEmbed`) with a link to its Match Centre; any others as match cards.
2. **Highlights** — active `tv_videos` (`.eq('active', true)`), newest `published_at` first, each with a category badge.
3. **Finals** — completed final-round matches with a replay.
4. **All Replays** — completed matches with a replay, newest first, a **hard `.limit(12)`** for v1 (no pagination / "load more" UI — that's a later seam; older replays are simply not shown for now).

Empty overall state (no live, no curated, no replays): a branded "Nothing on air yet" `EmptyState`.

### Interaction model
- **Curated videos** (no match page) → **play in an overlay player** (§4).
- **Match-derived cards** (finals/replays) → **link to `/matches/[id]`**, which already has the embed plus scores/players context.

Thumbnails: `thumbnail_url` if set, else derived `https://img.youtube.com/vi/{id}/hqdefault.jpg` via `parseYouTubeId`. Rendered with a plain `<img>` (avoids next/image remote-host config — same approach as `Avatar`). Cards use a 16:9 thumbnail with a play glyph overlay.

## 4. Overlay video player (decided: responsive overlay, not in-place)

`components/tv/VideoModal.tsx` (client) — opened by a curated `VideoCard` on click:
- **Mobile (`<640px`):** a **bottom sheet** — full width, slides up from the bottom, video at 16:9.
- **Desktop (`≥640px`):** a **centered modal**, `max-w-3xl`, video at 16:9.
- Dismiss via **backdrop tap**, **Escape**, and a **close button**. **Locks body scroll** while open; `role="dialog"` + `aria-modal`.
- **Autoplay MUST be muted.** Mobile browsers block autoplaying audio without a user gesture, so `autoplay=1` alone loads a paused video. `youtubeEmbedUrl` (`lib/matches/youtube.ts`) is extended to take `{ autoplay?, mute? }` and build the query string; `VideoModal` calls `youtubeEmbedUrl(id, { autoplay: true, mute: true })`. The viewer unmutes via the native player controls. Adding the `mute` option is backward-compatible — the existing `VideoEmbed` (match centre) passes neither flag and is unaffected.

`components/tv/VideoCard.tsx` (client) holds the open state and renders the thumbnail + title + category badge; clicking opens `VideoModal`. This is why the mobile decision is made up front — the card owns the player.

`components/tv/MatchVideoCard.tsx` (server) — a `Link` to `/matches/[id]` with thumbnail, participants, and score. Used by Finals and Replays.

## 5. Admin surface (`/admin/tv`)

Staff-visible (`adminOnly: false` — editorial content, not financial, so moderators may manage it). **Intentional consequence:** with `adminOnly: false` and the `tv_videos_staff_delete` RLS policy, moderators can hide/delete videos any admin uploaded. This is accepted for a small trusted team; if that changes later, tighten the delete policy to `is_admin()` and the nav to `adminOnly: true`. `app/admin/tv/page.tsx` (`requireStaff`):
- **Add video** form (`components/admin/TvVideoForm.tsx`, client + `useFormState`): title, category (select), YouTube URL, description. On submit → `addVideo` action.
- **Video list** (`components/admin/TvVideoRow.tsx`): each existing video with **Edit** (same form, prefilled), **Hide/Unhide** (toggles `active`), **Delete**.

Server actions in `lib/tv/admin-actions.ts` (`requireStaff` + session client so RLS staff policies apply; `created_by = ctx.userId`): `addVideo`, `updateVideo`, `toggleVideoActive`, `deleteVideo`. Each validates via `tvVideoSchema` and `revalidatePath('/tv')` + `revalidatePath('/admin/tv')`.

New `ADMIN_NAV` entry: `{ label: 'TV', href: '/admin/tv', adminOnly: false }`.

## 6. Shared helpers (`lib/tv/`) + testing

- `lib/tv/thumbnail.ts` — `youtubeThumbnail(url: string | null): string | null` (id via `parseYouTubeId` → `img.youtube.com/vi/{id}/hqdefault.jpg`, else null).
- `lib/tv/schema.ts` — `TV_CATEGORIES` (the four values), `CATEGORY_LABELS`, and `tvVideoSchema` (zod: `title` non-empty, `category` enum, `youtubeUrl` refined via `parseYouTubeId`, optional `description`/`thumbnailUrl`).

Colocated Vitest tests: `youtubeThumbnail` (each URL shape + unparseable → null) and `tvVideoSchema` (valid input, bad URL rejected, non-category rejected, empty title rejected). Admin actions stay thin.

## 7. Wiring & SEO

- **Bottom-bar Watch tab** → in `lib/nav/tabs.ts`, change the `watch` tab to `href: '/tv'`, `feature: null`, `match: '/tv'` (so it's active on `/tv`). This retires its coming-soon placeholder.
- **Desktop header** — add `{ href: '/tv', label: 'TV' }` to `SiteHeader`'s `NAV`.
- `/tv` `generateMetadata` + OpenGraph (WhatsApp previews).

## 8. Scope boundaries

**In:** `tv_videos` table + RLS + types regen; the `/tv` page (4 sections); overlay player; the `/admin/tv` CRUD; shared helpers + tests; Watch-tab + header wiring; SEO.
**Out (seams left):** playlists/collections, view counts, scheduling/premieres, non-YouTube sources, comments/reactions, drag-to-reorder. Curated section shows all active videos newest-first; per-category filtering can come later.
