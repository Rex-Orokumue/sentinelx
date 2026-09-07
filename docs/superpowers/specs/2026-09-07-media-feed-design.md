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
