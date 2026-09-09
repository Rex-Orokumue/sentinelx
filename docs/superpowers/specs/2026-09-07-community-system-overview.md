# Community System — Overview and Decomposition

**Date:** 2026-09-07
**Goal:** A social layer for SentinelX comparable to WhatsApp statuses, Facebook
feed and Instagram profiles.

This is not one project. It is four, and they are written as four specs because
each ships working software on its own and each can be cut without breaking the
others.

## What already exists

Substantial, and worth saying plainly before designing anything new: the
community already has posts, comments, replies, reactions, votes, challenges,
announcements, a gallery, top-member widgets, post boosts, best-play nominations
and — as of today — live comments and reactions. A Facebook-style feed is
largely built.

The gap is not "a community system". It is four specific things the existing
system does not do.

## The four pieces

| # | Piece | What it adds | Depends on |
|---|---|---|---|
| 1 | **Statuses** | Ephemeral 24-hour posts with a story tray and tap-through viewer | nothing |
| 2 | **Direct messages** | Private 1:1 conversations, with blocking and reporting | nothing |
| 3 | **Follows** | An asymmetric follow graph and a "following" feed | nothing |
| 4 | **Media feed** | Image-first post cards and a profile grid | the existing feed |

They are independent. Any one can ship alone; none blocks another.

## Order, and why

**Statuses first.** It shares no files or tables with anything else, so it can be
built while another session is working in the community code. It is also the
most visible change to a player — the tray appears the moment they open the page.

**Direct messages second.** Also entirely new tables. Highest value for a
tournament platform, where players constantly need to arrange fixtures, and the
thing most likely to be replaced by WhatsApp if it doesn't exist.

**Follows third.** Small schema, but it changes what the feed shows, so it is
better done once the feed is otherwise stable.

**Media feed last.** It edits the existing feed components — the highest chance
of colliding with concurrent work on the same files.

## Honest scope

These are not four things that fit in one day. Statuses and direct messages are
each roughly a day of work built properly; follows is half a day; the media feed
depends on how far the redesign goes.

Where time pressure applies, it must cut **named scope inside a piece** — a
"seen by" list, image attachments in messages — and never the safety work.
Blocking and reporting ship with direct messages or direct messages do not ship.
Most players on this platform are minors; private messaging without a way to
stop someone contacting you is not a smaller version of the feature, it is a
broken one.

## What is deliberately not here

- **Group chats.** 1:1 first. Groups multiply the moderation surface and are a
  separate project.
- **Voice and video.** Out of scope entirely.
- **Algorithmic ranking.** The feed stays chronological with boosts, as today.
- **Push notifications for social events.** The push system exists
  (`067_admin_push_notifications`, and today's fixes); wiring statuses and
  messages into it is a follow-up, not part of these four.

## Cross-cutting concerns

**Moderation.** Every piece adds user-generated content. Reporting must reach
the existing admin surfaces rather than inventing a new inbox.

**Storage.** Images reuse the `community-images` bucket with per-feature path
prefixes; no new bucket configuration in the dashboard.

**Realtime.** Everything live uses the same `ALTER PUBLICATION supabase_realtime`
pattern established by `081_community_realtime`, with RLS enforced on top.

**Expiry and cleanup.** Nothing user-visible may depend on a scheduled job
having run. This repo has no `vercel.json`; cron schedules are configured
outside it, and one of them (the rank snapshot job) is currently unwired.
Anything time-based is a query filter first, with cleanup as housekeeping.
