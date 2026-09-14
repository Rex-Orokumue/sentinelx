# Media-First Feed — Design

**Date:** 2026-09-07 · **Piece 4 of 4** — see `2026-09-07-community-system-overview.md`

## What it is

The Instagram half of the ask: posts that lead with their image rather than
their text, and a grid of a player's images on their profile.

## Why it is last

This is the only one of the four that **edits existing components** —
`PostCard`, `FeedList`, `CommunityGallery`, the profile page. Everything else
adds new files. When another session is working in the community code, this is
where a collision actually costs something.

It is also the least additive: the feed already works. This changes how it
looks, which is valuable but not new capability.

## What exists

Posts already support images (`community_post_images`, uploaded through
`PostComposer` with client-side resize into `community-images`). There is
already a `CommunityGallery`. The content is there; the presentation is
text-first.

## Changes

**`PostCard`** gains a media-first variant: when a post has images, the image
leads at full card width with the caption beneath, rather than text with a
thumbnail. Multi-image posts get a swipeable carousel with dots. Text-only posts
keep today's treatment — a media-first layout with no media is just a worse text
post.

**Profile grid** — a three-column square grid of a player's post images on their
profile, newest first, tapping through to the post. This is the single most
recognisably "Instagram" element and the highest value per unit of work.

**Feed density** — the feed currently mixes several card types (posts, match
results, announcements, best-play). A media-first redesign must not bury those;
they stay as they are, and only image posts change shape.

## Scope for v1

**In:** media-first post cards, multi-image carousel, profile image grid.

**Out:** filters and editing, alt text authoring, video, cropping to a fixed
aspect ratio on upload, saved/bookmarked posts.

**The cuttable corner:** the carousel. Showing the first image with a "+N"
badge is most of the value for a fraction of the work.

## Risk

Aspect ratios. Player-uploaded images are arbitrary; a grid needs squares and a
feed card needs a sane maximum height. Cropping to square in the grid is fine —
that is what a grid is — but the feed card should letterbox tall images rather
than crop faces out of them. This is exactly the class of bug that hit the game
cards today, where a fixed height cropped a quarter of the artwork away.

## Testing

Layout is verified at 360px and desktop with real posts of varied aspect ratios,
confirming no horizontal overflow — the failure mode this codebase has hit
repeatedly today.

---

## Addendum — 2026-09-13: multi-image is not actually wired up

The "What exists" section above is wrong, and wronger than first thought.
`community_post_images` was never wired up (`PostComposer` / `createPost` /
`feed-query.ts` only ever handled a single `image_url` column on
`community_posts`) — but it also no longer exists at all. It was created in
`017_community_login_gate_and_images.sql`, then **dropped** by
`056_phase3_social_feed.sql` (the Phase 3 Social Feed rebuild, which replaced
the whole v3.6 community schema with today's `community_posts` / post_type /
reactions / comments model) along with `community_reply_images`; only each
post's first image was migrated forward into the new single `image_url`
column. Nothing since has recreated it. Decided to build real multi-image
support now rather than cut it to a "+N" badge on one image.

**A new migration is needed** — `community_post_images` must be recreated
(same shape 017 used: `id`, `post_id` FK `ON DELETE CASCADE`, `image_url`,
`display_order`, `created_at`, RLS scoped to the post's `author_id` or
`is_staff()`), named with a UTC timestamp per CLAUDE.md. Replies are out of
scope for this piece — `community_reply_images` is not recreated.

**Write path**
- `createPost` takes `imageUrls: string[]` (cap 5, server-validated). The
  first URL still writes to legacy `community_posts.image_url` (keeps
  `CommunityGallery` and anything else reading that column unchanged); the
  rest bulk-insert into `community_post_images`.
- `PostComposer`: `<input multiple>`, cap 5, thumbnail strip. Upload stays
  deferred to submit (existing anti-orphan reasoning is unchanged).

**Read path**
- `hydratePosts` — shared by the feed list *and* post-detail, so this is one
  fix for both surfaces — gains a batched `community_post_images` query and a
  new `PostView.imageUrls: string[]`, falling back to `[imageUrl]` for
  pre-existing single-image posts.

**Display**
- `PostCard` / `ManualOrAchievementCard` get the media-first restructure
  described above: image(s) full-width right under the header, no
  padding/rounding on the image, caption + reactions below.
- New `PostMediaCarousel.tsx` (scroll-snap + dots, no library) for 2+ images.
  Single image is full-width letterboxed (`object-contain`), never cropped —
  the same class of bug that hit the game cards from a fixed-height crop.
  `match_result` / `announcement` cards are untouched.
- Profile grid: new query added to the existing `Promise.all` in
  `app/[locale]/(public)/players/[username]/page.tsx` — posts by that player
  with a non-null image, newest first, cap 18 — feeding a new
  `ProfileImageGrid.tsx` (3-col, square-cropped, fine for a grid), tapping
  through to `/community/{id}`. Placed as its own section near the existing
  `ProfileCommunityPosts`.

**Deliberately not touched:** `FeedList.tsx`, `FeedFilters.tsx`,
`CommunityGallery.tsx`, `ProfileHeader.tsx` — the files the concurrent
Follows session (piece 3) most likely owns.

Confirmed with the user 2026-09-13; next step is `writing-plans`.
