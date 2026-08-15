# SentinelX Phase 3 — Social Feed Design Spec

**Date:** 2026-08-15
**Status:** Approved → ready for implementation
**Phase:** 3 — The Community
**Routes:** `/community`, `/community/[postId]`

---

## 1. Vision

The social feed is the heartbeat of SentinelX — the place where the community lives between matches. It should feel like a WhatsApp group crossed with an esports highlights reel: fast, reactive, full of results and banter.

Every match result confirmed by admin auto-generates a post. Every achievement unlocked can be shared. Players post screenshots, trash talk, celebrate wins. Admin pins announcements at the top. The feed makes every match feel like a public event, not a private game.

**No followers/following in Phase 3.** Everyone sees everything — one shared community. This is intentional: SentinelX is small and tight-knit in Phase 3. Following is Phase 4+.

---

## 2. Post Types

| Type | Created by | Trigger |
|------|-----------|---------|
| `manual` | Player | Manual — player writes and publishes |
| `match_result` | System | Auto-generated when admin confirms a match result |
| `achievement` | System | Auto-generated when player unlocks an achievement (optional — player opts in) |
| `announcement` | Admin | Manual — admin creates, always pinned above all other posts |

### Match Result Auto-Post

When admin confirms a match result, the system creates a `match_result` post. It is never editable or deletable by either player — only by admin. It renders as a special card (see §5).

Content generated automatically:
```
🏆 Match Result — DLS Community Club #3
methio 3 – 1 Arole
Round of 16 · Sat 16 Aug 2026
[View Match →]
```

### Achievement Auto-Post

When a player unlocks an achievement, the system checks `achievements.share_to_feed` (boolean, default false). If true, it auto-creates an `achievement` post on their behalf. Players can opt out of this per-achievement in account settings.

Content generated:
```
👑 methio just unlocked "Tournament Champion"!
First tournament win — SentinelX Community Club #3
+500 XP · +250 coins
```

---

## 3. Database Schema

```sql
-- Posts
CREATE TABLE community_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content       text NOT NULL CHECK (char_length(content) <= 500),
  image_url     text,                        -- optional screenshot
  post_type     text NOT NULL DEFAULT 'manual'
                CHECK (post_type IN ('manual','match_result','achievement','announcement')),
  reference_id  uuid,                        -- match_id or achievement_id if auto-generated
  is_pinned     boolean NOT NULL DEFAULT false,
  is_deleted    boolean NOT NULL DEFAULT false,  -- soft delete
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Reactions
CREATE TABLE post_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction    text NOT NULL CHECK (reaction IN ('fire','crown','strong','wow')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, player_id)     -- one reaction per player per post (can change type)
);

-- Comments
CREATE TABLE post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content     text NOT NULL CHECK (char_length(content) <= 280),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Indexes:**
```sql
CREATE INDEX ON community_posts (created_at DESC) WHERE is_deleted = false;
CREATE INDEX ON community_posts (is_pinned) WHERE is_pinned = true;
CREATE INDEX ON post_reactions (post_id);
CREATE INDEX ON post_comments (post_id, created_at);
```

**RLS:**
```sql
-- Posts: everyone can read non-deleted posts
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read posts" ON community_posts FOR SELECT USING (is_deleted = false);
CREATE POLICY "players create manual posts" ON community_posts FOR INSERT
  WITH CHECK (auth.uid() = author_id AND post_type = 'manual');
CREATE POLICY "players soft-delete own posts" ON community_posts FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (is_deleted = true);  -- players can only set is_deleted, nothing else
-- System/admin inserts (match_result, achievement, announcement) via service role only

-- Reactions: authenticated players only
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reactions" ON post_reactions FOR SELECT USING (true);
CREATE POLICY "manage own reaction" ON post_reactions FOR ALL USING (auth.uid() = player_id);

-- Comments: authenticated players only
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read comments" ON post_comments FOR SELECT USING (is_deleted = false);
CREATE POLICY "players comment" ON post_comments FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "players delete own comment" ON post_comments FOR UPDATE
  USING (auth.uid() = author_id) WITH CHECK (is_deleted = true);
```

---

## 4. Feed Page (`/community`)

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│  COMMUNITY FEED                     [+ New Post]               │
│  Nigeria's Home of Mobile Esports                              │
├────────────────────────────────────────────────────────────────┤
│  [Filter: All | Results | Announcements | Achievements]        │
├────────────────────────────────────────────────────────────────┤
│  [📌 PINNED ANNOUNCEMENT — always top]                         │
│  ─────────────────────────────────────────────────────────     │
│  [match_result card]                                           │
│  [manual post card]                                            │
│  [achievement card]                                            │
│  [manual post card]                                            │
│  ...                                                           │
│  [Load more]                                                   │
└────────────────────────────────────────────────────────────────┘
```

**Header:** "COMMUNITY FEED" in Barlow Condensed 28px. "+ New Post" button — opens the post composer (§6). Only shown to authenticated players.

**Filter tabs:** All / Results / Announcements / Achievements. Client-side filter — data already loaded, no refetch. Default: All.

**Feed order:**
1. Pinned announcements always at top (regardless of age)
2. All other posts in reverse chronological order

**Pagination:** Initial load = 20 posts. "Load more" button at bottom fetches next 20. No infinite scroll — "Load more" is better for mobile data usage.

**Guest view:** Feed is public (no auth required to read). "+ New Post" and reaction/comment interactions require login — clicking them redirects to `/login?next=/community`.

---

## 5. Post Cards

### 5.1 Manual Post Card

```
┌────────────────────────────────────────────────────────────┐
│  [HexAvatar xs]  methio              🔥 Elite    2h ago    │
│  ─────────────────────────────────────────────────────     │
│  Finally beat Arole 3–1 in the semis 👑 Been waiting for   │
│  this one. Watch out for the finals 💪                     │
│                                                            │
│  [Screenshot image — optional, tap to expand]             │
│                                                            │
│  🔥 14   👑 8   💪 3   😮 1         [💬 5]  [↗ Share]     │
└────────────────────────────────────────────────────────────┘
```

- Author: `HexAvatar xs` + display name + tier badge + relative time
- Content: up to 500 chars, plain text (no markdown, no links in content — spam prevention)
- Image: optional, tap/click expands to full-screen. Stored in Supabase Storage (`community-images` bucket)
- Reactions row: shows emoji + count for each of the 4 types. Tapping a reaction toggles your reaction (upsert on `post_reactions`). If you've already reacted with that type, tapping again removes it. If you tap a different type, it replaces your current one.
- Comment count: `💬 5` — tapping opens the post detail page (`/community/[postId]`)
- Share: opens native share sheet on mobile, prefills "Check this out on SentinelX: [url]" on desktop. WhatsApp share is the first option.
- Author's own post: shows `⋯` menu (top-right) → Delete. No edit — simplifies feed integrity.

### 5.2 Match Result Card

Distinct visual treatment — more prominent, system-generated.

```
┌────────────────────────────────────────────────────────────┐
│  🏆  MATCH RESULT                      Community Club #3   │
│  ─────────────────────────────────────────────────────     │
│  [HexAvatar sm]    3  –  1   [HexAvatar sm]               │
│   methio                         Arole                     │
│   🟢 Elite                       🔵 Guardian               │
│  ─────────────────────────────────────────────────────     │
│  Round of 16 · Sat 16 Aug 2026 · 8:00 PM WAT              │
│                                                            │
│  🔥 22   👑 11   💪 5   😮 2        [💬 8]  [↗ Share]      │
│                                       [View Match →]       │
└────────────────────────────────────────────────────────────┘
```

- Border: `border-sx-purple/40` with subtle purple glow — visually distinct from manual posts
- Both `HexAvatar sm` components with tier frames
- Winner's name in white, loser's name in `text-sx-gray`
- No delete option for either player — admin-only moderation
- "View Match →" links to `/matches/[id]`

### 5.3 Achievement Card

```
┌────────────────────────────────────────────────────────────┐
│  🏅  ACHIEVEMENT UNLOCKED                          2h ago  │
│  ─────────────────────────────────────────────────────     │
│  [HexAvatar xs]  methio                                    │
│  👑  Tournament Champion                                   │
│  First tournament win — SentinelX Community Club #3        │
│  +500 XP · +250 coins                                      │
│                                                            │
│  🔥 18   👑 9               [💬 3]   [↗ Share]             │
└────────────────────────────────────────────────────────────┘
```

Gold-tinted border (`border-amber-500/30`).

### 5.4 Announcement Card (Pinned)

```
┌────────────────────────────────────────────────────────────┐
│  📌  ANNOUNCEMENT                  Sentinel X Esports      │
│  ─────────────────────────────────────────────────────     │
│  🏆 Season 1 Community Club #4 registrations are now       │
│  open! Entry fee: ₦500. Register before Sunday 8 PM.       │
│  [Register Now →]                                          │
└────────────────────────────────────────────────────────────┘
```

- Purple left border (`border-l-4 border-sx-purple`)
- No reactions or comments on announcements — they're broadcast-only
- "Register Now →" link is optional, set by admin when creating the announcement
- Multiple pinned announcements stack in order of creation (newest first within pinned group)

---

## 6. Post Composer

Opens as a **bottom sheet on mobile, modal on desktop** — not a new page.

```
┌────────────────────────────────────────────────────────────┐
│  NEW POST                                            [✕]   │
│  ─────────────────────────────────────────────────────     │
│  [HexAvatar sm — your avatar]                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  What's happening in the SentinelX community?        │  │
│  │                                                      │  │
│  │                                        0 / 500       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  [📷 Add Screenshot]                                       │
│                                                            │
│             [Cancel]    [Post]                             │
└────────────────────────────────────────────────────────────┘
```

- Textarea: 500 char limit, live counter
- Image upload: optional. Single image. Uploaded to Supabase Storage on submit, not on selection (avoid orphaned uploads).
- Submit: Server Action → insert into `community_posts` → redirect/revalidate feed
- Empty post (no text, no image): "Post" button disabled
- `"use client"` component — the composer needs controlled input and file selection

---

## 7. Post Detail Page (`/community/[postId]`)

Shows the full post + all comments. Server Component.

```
┌────────────────────────────────────────────────────────────┐
│  ← Back to Community                                       │
│                                                            │
│  [Post card — full version]                                │
│  ─────────────────────────────────────────────────────     │
│  COMMENTS (5)                                              │
│                                                            │
│  [HexAvatar xs] Arole   1h ago                            │
│  GG bro, deserved win 🤝                                   │
│                                                            │
│  [HexAvatar xs] Drizzy   45m ago                          │
│  methio on form 🔥🔥                                       │
│  ─────────────────────────────────────────────────────     │
│  [Write a comment...]          [Send]                      │
└────────────────────────────────────────────────────────────┘
```

- All comments loaded on page load (no pagination in Phase 3 — assume ≤ 50 comments per post)
- Comment input at bottom — `"use client"` for the input only
- Comment submission: Server Action → insert `post_comments` → revalidate
- Comment length max: 280 chars
- Own comment: long-press (mobile) or hover (desktop) shows Delete option

---

## 8. Weekly Community Challenges

Challenges are displayed in a sticky widget in the community feed sidebar (desktop) or as a collapsible banner at the top of the feed (mobile). They reset every Monday 00:00 WAT.

### DB additions

```sql
-- Weekly challenge definitions (seeded, not user-created)
CREATE TABLE community_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  title        text NOT NULL,
  description  text NOT NULL,
  coin_reward  integer NOT NULL DEFAULT 0,
  xp_reward    integer NOT NULL DEFAULT 0,
  challenge_type text NOT NULL  -- 'matches_played' | 'matches_won' | 'post_created' | 'reactions_given'
);

-- Per-player per-week progress
CREATE TABLE player_challenge_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenge_id  uuid NOT NULL REFERENCES community_challenges(id),
  week_start    date NOT NULL,   -- Monday of the week (UTC)
  progress      integer NOT NULL DEFAULT 0,
  completed     boolean NOT NULL DEFAULT false,
  rewarded_at   timestamptz,
  UNIQUE(player_id, challenge_id, week_start)
);
```

### Seeded challenges (4 weekly challenges)

| Slug | Title | Goal | Coins | XP |
|------|-------|------|-------|----|
| `weekly_grind` | The Grind | Play 3 matches | +100 | +50 |
| `weekly_winner` | Winner's Circle | Win 2 matches | +200 | +100 |
| `weekly_post` | Community Voice | Post in the feed | +25 | +20 |
| `weekly_react` | Hype Man | React to 5 posts | +15 | +10 |

### Progress tracking

Challenge progress is incremented server-side by the same Server Actions / triggers that handle match results and post creation:
- Match confirmed → increment `weekly_grind` + (if winner) `weekly_winner` for that player
- Post created → increment `weekly_post`
- Reaction added → increment `weekly_react`

When `progress` reaches the goal threshold, mark `completed = true`, award coins + XP via existing `recordCoinTransaction()` and `recordXpEvent()` helpers, set `rewarded_at = now()`. Idempotent — the `UNIQUE` constraint prevents double-awarding.

### Challenge widget UI

```
THIS WEEK'S CHALLENGES                    Mon 11 – Sun 17 Aug
──────────────────────────────────────────────────────────────
✅ The Grind        Play 3 matches    ████████ 3/3  +100 🪙
🔄 Winner's Circle  Win 2 matches     ████░░░░ 1/2  +200 🪙
✅ Community Voice  Post in feed      ████████ 1/1  +25 🪙
🔲 Hype Man         React to 5 posts  ░░░░░░░░ 0/5  +15 🪙
```

- ✅ = completed + rewarded (green)
- 🔄 = in progress (purple progress bar)
- 🔲 = not started (grey)

---

## 9. Best Play of the Week

Admin-curated, community-voted. Runs on a 7-day cycle.

### Flow

1. **Friday 9 AM WAT:** Admin nominates a match result post or screenshot post from the past week via `/admin/community` → "Nominate Best Play"
2. **Friday 9 AM → Sunday 9 PM WAT:** Voting window — a "🎯 VOTE FOR BEST PLAY" banner appears at the top of the feed with the nominated post(s). Players tap "Vote 🔥" — one vote per player.
3. **Sunday 9 PM WAT:** Admin clicks "Confirm Winner" in `/admin/community`. System awards:
   - Winner: +500 coins, +200 XP, `best_play_winner` achievement (if not already unlocked), "🎯 Best Play" badge appears on their post for 7 days
   - Runner-up (highest votes, didn't win): +200 coins, +100 XP
4. Winner announced via auto-generated `announcement` post in the feed.

### DB additions

```sql
CREATE TABLE best_play_nominations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES community_posts(id),
  week_start   date NOT NULL,
  is_winner    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE best_play_votes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id   uuid NOT NULL REFERENCES best_play_nominations(id),
  player_id       uuid NOT NULL REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, week_start)  -- one vote per player per week
);
```

---

## 10. Match Result Auto-Post Integration

When admin confirms a match result in the Admin Dashboard (`/admin/matches/[id]`), the existing Server Action that writes the result must also:

1. Create a `community_posts` row with `post_type = 'match_result'`, `reference_id = match.id`, and auto-generated `content` (template in §2)
2. Increment `weekly_grind` for both players (both played)
3. Increment `weekly_winner` for the winning player
4. Check and award weekly challenge completions for both players

All of this runs in the same Server Action / database transaction as the result confirmation — atomic. If the feed post fails, the result confirmation still goes through (non-blocking).

---

## 11. Admin Controls (`/admin/community`)

New admin page. Admin/Moderator roles can access.

| Action | Description |
|--------|-------------|
| Pin/unpin posts | Toggle `is_pinned` on any post |
| Delete any post | Soft delete (`is_deleted = true`) + reason logged |
| Create announcements | Post with `post_type = 'announcement'` |
| Nominate Best Play | Select a post from the week for nomination |
| Confirm Best Play winner | After voting closes, confirm + trigger awards |
| View reported posts | (Phase 3+ — report button on posts) |

---

## 12. WhatsApp Share Integration

Every post card and post detail page has a "↗ Share" button. On tap:

```
https://wa.me/?text=Check%20this%20out%20on%20SentinelX%3A%20https%3A%2F%2Fsentinelxesports.com%2Fcommunity%2F[postId]
```

Match result posts get a richer prefill:
```
🏆 methio beat Arole 3-1 in the DLS Community Club #3!
Watch the action: https://sentinelxesports.com/community/[postId]
```

No API calls — pure `wa.me/?text=` link. Same pattern already used on tournament pages.

---

## 13. Component Structure

```
app/(public)/community/
  page.tsx                      ← Feed (Server Component — initial 20 posts)
  [postId]/page.tsx             ← Post detail + comments (Server Component)

components/community/
  PostCard.tsx                  ← Shared card — handles all 4 post types
  MatchResultCard.tsx           ← Special match result card layout
  AnnouncementCard.tsx          ← Pinned announcement card
  PostComposer.tsx              ← "use client" — composer modal/sheet
  CommentInput.tsx              ← "use client" — comment input
  ReactionBar.tsx               ← "use client" — emoji reaction toggle
  CommentList.tsx               ← Server Component
  FeedFilters.tsx               ← "use client" — filter tabs (client-side filter)
  ChallengeWidget.tsx           ← Weekly challenges — Server Component (data pre-fetched)
  BestPlayBanner.tsx            ← Voting banner — Server Component
```

---

## 14. Performance Notes

- Feed is public → can be cached at the CDN level with `revalidate = 60` (1-minute stale)
- Match result auto-posts and admin announcements call `revalidatePath('/community')` after creation
- Images in posts: compress to max 800px wide, WebP, on upload via a Supabase Edge Function (or client-side canvas resize before upload if Edge Function is too complex — acceptable tradeoff in Phase 3)
- `post_reactions` counts: aggregate via a Supabase view or compute in the page query — do NOT do N+1 reaction count queries per post

---

## 15. Out of Scope (Phase 3)

- Follow/following system — Phase 4
- Direct messages — Phase 4
- Video posts / clips — Phase 4 (screenshot images only for now)
- Post reporting by players — Phase 3+ (admin can delete any post; player reports come later)
- Hashtags or topics — Phase 4
- Mentions (@username) — Phase 3+
- Notification when someone comments on your post — Phase 3 WhatsApp notification spec (separate)
