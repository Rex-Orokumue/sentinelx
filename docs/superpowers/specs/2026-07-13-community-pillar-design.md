# Community Pillar (v1 — forum, not chat) — Design

Builds out the 🤝 Community pillar from CLAUDE.md's Four Pillars table ("Posts,
discussions, announcements"), which currently routes to `/coming-soon?feature=Community`
with no real page behind it. This is a public discussion feed, per-game, with
one level of replies — not real-time messaging. No new infrastructure class
(WebSockets, presence, Supabase Realtime) is introduced.

Builds on the current schema (through migration `015_registration_details.sql`) and
the multi-game scaffolding already in place (`games` table, `game_id` FKs on
`tournaments`).

---

## Why per-game, not per-tournament, not a single global feed

Every tournament already belongs to a game (`tournaments.game_id`), and CLAUDE.md's
standing rule is that every system must be designed multi-game from day one. A
per-game board is the natural grouping that will still make sense once more games
launch (v4.0), whereas a single global feed would need retrofitting later. Only one
game exists today (Dream League Soccer), so the game selector on `/community` will
show a single option at launch — that's expected, not a placeholder to remove later.
Per-tournament boards were considered and explicitly deferred (per-tournament granularity
can be added later if per-game proves too coarse, without reworking this schema — it
would just add a nullable `tournament_id` column).

---

## Data model

New migration `016_community.sql`:

```sql
CREATE TABLE public.community_posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    uuid        NOT NULL REFERENCES public.games(id),
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_replies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.community_posts (game_id);
CREATE INDEX ON public.community_posts (created_at DESC);
CREATE INDEX ON public.community_replies (post_id);

CREATE TRIGGER set_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

`community_replies` has no `image_url` — replies are text-only (per the "one level,
Instagram-comment-style" decision; images are for the original post only, keeping
reply composition lightweight).

No `updated_at` / edit support on either table for v1 — posts and replies are
delete-and-repost only. `set_updated_at` is still attached to `community_posts` for
consistency with every other table in this schema that has the column, even though
nothing writes an update yet; if editing is added later the trigger is already there.

The `CHECK (char_length(body) <= 2000)` constraint is the backstop; the server
action's Zod schema (`z.string().trim().min(1).max(2000)`, matching the
`optionalText`/`title` pattern already used in `lib/tournaments/admin-schema.ts`)
is what actually produces a friendly error — the DB constraint exists so a bug in
the app layer can never bypass the limit, not as the primary validation path.

### RLS

```sql
ALTER TABLE public.community_posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_replies ENABLE ROW LEVEL SECURITY;

-- Public read, matching /tournaments and /exchange — logged-out visitors can browse.
CREATE POLICY "community_posts_public_read"   ON public.community_posts   FOR SELECT USING (true);
CREATE POLICY "community_replies_public_read" ON public.community_replies FOR SELECT USING (true);

-- Any authenticated player can post/reply as themselves.
CREATE POLICY "community_posts_own_insert"   ON public.community_posts   FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "community_replies_own_insert" ON public.community_replies FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Author deletes their own; staff (admin + moderator — content moderation isn't a
-- financial action) deletes anything. is_staff() already exists (migration 001).
CREATE POLICY "community_posts_delete"   ON public.community_posts   FOR DELETE USING (auth.uid() = author_id OR is_staff());
CREATE POLICY "community_replies_delete" ON public.community_replies FOR DELETE USING (auth.uid() = author_id OR is_staff());
```

No UPDATE policy on either table — matches "no edit in v1."

### Storage

New public bucket `community-images`, same shape as the existing `listing-images`
bucket (migration `012_listing_images.sql`): public read, authenticated users can
upload to their own path, owner (or staff) can delete. One image per post, optional.

---

## Pages

### `/community` (public, in the `(public)` route group)

- Server Component fetches `games` (active only, same as tournament creation) and
  the selected game's posts (newest-first, paginated — see Pagination below), each
  with reply count.
- **Game selector**: a row of game tabs/pills above the feed (client component,
  `?game=<slug>` query param drives the active one, defaulting to the first active
  game — mirrors the pattern already used for the tournament listing page's game
  filter, per `project_current_phase` memory: "URL-param game filter that
  auto-shows at 2+ active games"). With one game today, the selector renders but
  is inert (a single active pill) — this is intentional, not a bug to "fix" later.
- **Composer**: logged-in players see a form (textarea + optional image file input)
  above the feed; logged-out visitors see a "Log in to post" prompt instead (same
  pattern as `RegistrationPanel`'s guest state).
- **Feed**: each post shows author (avatar/name via the existing `Avatar` component),
  body, optional image, relative/formatted timestamp (`formatDateTime`), and a reply
  count. Clicking a post expands its replies inline (client component) and shows a
  reply composer (text-only) for logged-in players.
- **Delete**: a "Delete" action appears on a post/reply only for its author or staff
  (mirrors `TournamentListRow`'s conditional action pattern), calls a Server Action,
  revalidates the page.

### `/admin/community` (staff-only, new `ADMIN_NAV` entry, no `adminOnly` flag — moderators can access)

- Lists recent posts (newest-first, capped, with the admin player-search box from
  `lib/admin/search.ts` filtering by author username) with a "Remove" action per row
  (reuses the same DELETE RLS policy via the session client, no admin client needed
  since staff already satisfies `is_staff()`).
- No approve/reject queue — matches "live immediately, remove after" from the design
  discussion. This page exists so staff can review/clean up without having to browse
  the public feed as themselves.

### Pagination

Community feeds grow unboundedly, unlike every other list in this app (tournaments,
listings, registrations are all naturally bounded in count). `/community` loads the
most recent 30 posts server-side with a "Load more" link that bumps a `?before=`
cursor (created_at of the last loaded post) — simplest correct approach without
adding a new pagination library or infinite-scroll JS. `/admin/community` caps at 50
with the same cursor pattern.

---

## Nav wiring

- `lib/nav/tabs.ts`'s `PILLAR_TABS` entry for `community` currently points to
  `/coming-soon?feature=Community` with `feature: 'Community', match: null`. Change
  to `href: '/community', feature: null, match: '/community'` — same shape as the
  `compete`/`watch`/`trade` entries that already point at real pages. This drives
  the mobile `BottomTabBar`.
- **Desktop has no Community entry at all today** — verified by inspecting
  `components/shared/SiteHeader.tsx`: its `NAV` array is
  `[Tournaments, TV, Exchange, Rankings]`, no Community. The header's visible
  "Community" button (green, WhatsApp-icon) is the unrelated external
  `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL` CTA from CLAUDE.md's "Join our WhatsApp
  Community" spec — do not touch it, it's a different feature. Add a new
  `{ href: '/community', label: 'Community' }` entry to `SiteHeader.tsx`'s `NAV`
  array so desktop users can reach the page at all.
- `/coming-soon` itself is untouched — it stays as the shared landing page for
  future unbuilt features (multi-game, team leagues). Its `Community` entry in
  `lib/nav/coming-soon.ts` becomes dead (no remaining caller passes
  `feature=Community`) — leave it in place rather than deleting; removing unused
  copy from a lookup map is not worth a special-case diff.

---

## Explicitly out of scope for v1

- Real-time delivery — the feed is server-rendered and revalidates on
  post/reply/delete, like every other page in this app; no live-updating without a
  refresh.
- Nested replies (replies-to-replies) — one level only, replies attach to the post.
- Editing posts or replies — delete-and-repost only.
- Video attachments — conflicts with the platform's established
  no-native-video-hosting rule (YouTube-embed-only, per CLAUDE.md); if video sharing
  is wanted later, the right shape is a pasted YouTube link rendered as an embed,
  not a file upload.
- Per-tournament boards — per-game only; the schema doesn't block adding
  `tournament_id` later if per-game proves too coarse.
- Rate limiting / spam throttling — relying on staff moderation (delete + existing
  admin-flag/conduct tooling) rather than new infrastructure for v1.
- Sentinel Score integration — no new score events tied to community moderation;
  the existing `admin_flag_conduct` event type already covers a staff response to
  bad behavior if needed, no new event type is being added here.
- Image pre-moderation — Gaming Exchange listing images go through Samuel's
  approval queue before going live; community post images do not (there is no
  pre-moderation step at all in this design — "live immediately, remove after"
  applies to images the same as text). Acceptable for v1 since staff can delete
  the whole post, but worth stating explicitly so this isn't mistaken for an
  oversight later.
- Orphaned image cleanup on delete — deleting a post does not delete its image
  from the `community-images` bucket; the file is simply orphaned. Same known,
  already-accepted gap as Gaming Exchange's listing images (#13a, "orphaned Storage
  files on delete = known tech debt") — not solved here for the same reason: it's a
  storage cost, not a data-safety or correctness problem, and cleanup can be added
  later as a batch job without changing anything about this design.
