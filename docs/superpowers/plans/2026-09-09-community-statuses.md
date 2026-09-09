# Community Statuses (24-Hour Stories) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Piece 1 of the community rebuild — ephemeral 24-hour player statuses with a ring tray on `/community`, a full-screen tap-through viewer, a seen-by list, and staff takedown.

**Architecture:** The schema and the pure ring-grouping logic (`lib/community/statuses.ts`, 11 tests) already exist on this branch. This plan adds the data-access layer, three server actions, three client components (tray, composer, viewer), the `/community` page wiring, realtime, and an admin moderation surface. It follows the patterns the existing community feed established: server components hydrate data in a fixed number of round trips, `'use client'` islands handle interaction, `createClient()` (request-scoped, RLS-enforced) for reads/writes, `router.refresh()` for realtime, and manual end-to-end verification for UI (only pure logic is unit-tested).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Storage + Realtime), Tailwind, `zod`, `vitest`, `lucide-react`.

**Spec:**
- `docs/superpowers/specs/2026-09-07-statuses-design.md` (this piece)
- `docs/superpowers/specs/2026-09-07-community-system-overview.md` (cross-cutting rules)

## Execution progress (2026-09-09)

| Task | State | Commit |
|---|---|---|
| 1 · Schema + staff policy + types | ✅ done | `fea4d02` |
| 2 · Validation schema (TDD) | ✅ done | `3ed8b17` |
| 3 · Query + server actions | ✅ done | `b111711` |
| 4 · StatusRing + StatusTray | ✅ done | `c924c9d` |
| 5 · StatusComposer | ✅ done | `52c10f8` |
| 6 · StatusViewer | ✅ done | `ed567c7` |
| 7 · Page wiring + realtime | ✅ done | `c013af0` |
| 8 · Admin moderation | ✅ done | `2d5831b` |
| 9 · E2E verification | ✅ done | user-run on the Vercel preview; fixes below |

**Post-verification fixes (from the user's E2E pass):**
- `9104152` — desktop viewer was unusable (flex-1 media div with no `min-h-0` let the image inflate the column past the viewport, hiding the footer); rebuilt as a bounded phone-shaped card. Seen-by sheet opened before its fetch resolved and never refreshed → loading state, clears on open, closes on advance, polls every 4s.
- `043662b` — feed top decluttered: hero only for logged-out visitors, inline composer box replaces the hidden `+ New Post` button, stats/quick-action tiles moved below the feed.
- `afca239` — `ChallengeWidget` (`lg:sticky`) moved to last in the sidebar so "Upcoming Tournaments" no longer renders behind it.
- `97d7882` — merged `origin/main` (28 commits: multi-format tournaments, sign-in methods, avatar frames, change-email); `lib/supabase/types.ts` regenerated from the live schema.

**Verified:** `tsc --noEmit` clean · `next lint` clean · full `vitest run` green · Vercel preview builds **READY, 0 errors**.

**Task 1 deviation from plan:** the base migration `20260907120000_player_statuses.sql` **was already applied to production** (recorded remotely as version `20260907165549` — a local/remote filename skew, tables + all 5 original policies present and correct). The plan assumed it was unapplied; only the new `player_statuses_staff_delete` + `status_views_staff_read` policies needed applying, done via MCP `apply_migration` (`20260909082245_player_statuses_staff_delete.sql`).

## Global Constraints

- **Mobile-first.** Design at 375px, scale up. The tray and viewer are primarily a phone experience.
- **RLS on every table.** `player_statuses` and `status_views` already have policies; Task 1 adds the missing staff-delete policy.
- **Expiry is a query filter, never a job.** Every read of `player_statuses` filters `expires_at > now()`. Nothing user-visible may depend on a cleanup job having run. (`isLive()` enforces the same in `lib/community/statuses.ts`.)
- **Statuses are immutable.** No UPDATE policy, no edit UI. Authors delete early; they never rewrite.
- **Storage path:** status images go to the existing `community-images` bucket at `${userId}/statuses/${uuid}.jpg`. The bucket's INSERT policy (`016_community.sql`) requires `(storage.foldername(name))[1] = auth.uid()::text` — the **UID must be the first path segment**, with `statuses/` as a sub-prefix. No bucket or policy change.
- **Caption:** ≤ 200 characters, and a status must have an image or a non-blank caption (DB CHECK `player_statuses_has_content` + `player_statuses_caption_len`).
- **Client-side image resize before upload** via `resizeImageToMaxWidth(file, maxWidth)` from `@/lib/media/resize-image` (browser-only). Statuses use `maxWidth = 1080` (portrait story format, larger than the feed's 800).
- **Migrations are timestamp-named.** Any new migration file: `YYYYMMDDHHMMSS_name.sql` (UTC).
- **Supabase project id for type generation:** `itxubrkbropttfdackmi`.
- **This is a git worktree** at `.claude/worktrees/community-statuses` on branch `feat/community-statuses`. It is **not linked** to Supabase — migration application and `gen types` must run from the primary checkout (`C:/Users/gorok/Videos/sentinelx`, which is linked) or via the Supabase MCP tools. Concurrent sessions are active in the primary checkout: do **not** run `npm run build` (their `next dev` may be running); verify with `npx tsc --noEmit` + `npx next lint` locally and on Vercel after push.
- **Out of scope (spec §"Scope for v1"):** replies to a status, reactions to a status, mentions, music, text-only styled backgrounds, "close friends" visibility, push notifications for statuses.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `lib/community/status-schema.ts` | `zod` schema + `validateStatusInput()` — the one place caption/content rules live client- and server-side |
| `lib/community/status-schema.test.ts` | Unit tests for the schema (the only TDD task) |
| `lib/community/status-query.ts` | `fetchStatusRings(viewerId)` and `fetchStatusViewers(statusId)` — server-only reads |
| `lib/community/status-actions.ts` | `'use server'` — `postStatus`, `deleteStatus`, `recordStatusView` |
| `components/community/StatusTray.tsx` | `'use client'` — the ring row at the top of `/community`; owns optimistic seen-state and which overlay is open |
| `components/community/StatusComposer.tsx` | `'use client'` — image picker + caption, uploads then calls `postStatus` |
| `components/community/StatusViewer.tsx` | `'use client'` — full-screen tap-through player with segment progress bars, delete, and the seen-by sheet |
| `components/community/StatusRing.tsx` | Small presentational ring-avatar (used by the tray) |
| `components/admin/AdminStatusList.tsx` | `'use client'` — staff list of live statuses with a delete control |
| `supabase/migrations/<timestamp>_player_statuses_staff_delete.sql` | Adds `player_statuses_staff_delete` + `status_views_staff_read` policies |

**Modified files:**

| Path | Change |
|---|---|
| `supabase/migrations/20260907120000_player_statuses.sql` | *(only its doc comment)* — correct the "already applied" line to reflect reality; **do not** alter DDL here, the staff policy is a separate timestamped migration |
| `lib/supabase/types.ts` | Regenerated after the migration is applied |
| `app/[locale]/(public)/community/page.tsx` | Fetch rings, render `<StatusTray>` above the feed |
| `components/community/CommunityRealtime.tsx` | Subscribe to `player_statuses` (INSERT + DELETE) so a new/removed status re-renders the tray |
| `app/[locale]/admin/community/page.tsx` | Add a "Statuses — live" section |
| `lib/community/admin-query.ts` | Add `fetchAdminStatuses()` |
| `lib/community/admin-actions.ts` | Add `adminDeleteStatus()` |

---

## Task 1: Schema — staff moderation policy, apply, regenerate types

**Files:**
- Create: `supabase/migrations/<timestamp>_player_statuses_staff_delete.sql`
- Modify: `supabase/migrations/20260907120000_player_statuses.sql` (doc comment only)
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: the `player_statuses` and `status_views` tables live in production, `Database['public']['Tables']['player_statuses']` and `['status_views']` exist in `lib/supabase/types.ts`, and staff can delete any status.

**Why:** The base migration (`20260907120000_player_statuses.sql`) is committed on this branch but **not applied to production** — the remote migration history jumps from `20260907065446` to `20260907154831` with no `20260907120000`. It also lacks a staff-takedown policy: it only has `player_statuses_own_delete` (`auth.uid() = player_id`). Posts have `community_posts_staff_manage`; statuses need the equivalent, because "most players on this platform are minors" and a moderator must be able to remove a harmful status.

- [ ] **Step 1: Correct the stale comment in the base migration**

In `supabase/migrations/20260907120000_player_statuses.sql`, the header comment is fine, but `docs/superpowers/specs/2026-09-07-statuses-design.md` says "already applied" — leave the spec alone (it is historical) but make sure the migration file's own comment does not claim it is applied. It currently does not, so **no change may be needed** — verify and move on. Do **not** touch the DDL in this file.

- [ ] **Step 2: Write the staff-delete migration**

Create `supabase/migrations/<timestamp>_player_statuses_staff_delete.sql` (use the real current UTC timestamp, e.g. `20260909101500`):

```sql
-- Staff takedown for statuses. The base migration (20260907120000) only lets an
-- author delete their own status. Posts have community_posts_staff_manage; a
-- status shown to the whole community needs the same — most players here are
-- minors and a moderator must be able to pull a harmful status.
--
-- Deleting the player_statuses row cascades its status_views (FK ON DELETE
-- CASCADE), so no separate cleanup. status_views also gets a staff SELECT
-- policy so the admin surface can show a view count without the service role.

CREATE POLICY "player_statuses_staff_delete" ON public.player_statuses
  FOR DELETE USING (public.is_staff());

CREATE POLICY "status_views_staff_read" ON public.status_views
  FOR SELECT USING (public.is_staff());
```

- [ ] **Step 3: Apply both migrations to production**

This worktree is not linked. Apply from the primary checkout **or** via MCP:

- **Preferred (MCP):** Supabase `apply_migration` tool, once per file, names `20260907120000_player_statuses` then `<timestamp>_player_statuses_staff_delete`.
- **Or CLI from `C:/Users/gorok/Videos/sentinelx`:** `npx supabase db push` (intermittently unreachable on this machine — see memory `project_supabase_connectivity_gotcha`; prefer MCP).

If neither is available to you, **stop and ask the user to apply them** — every later task depends on the tables existing.

- [ ] **Step 4: Verify in production**

Run via MCP `execute_sql` (or `npx supabase db execute`):

```sql
SELECT to_regclass('public.player_statuses') AS statuses,
       to_regclass('public.status_views')    AS views;
SELECT polname FROM pg_policy
WHERE polrelid = 'public.player_statuses'::regclass
ORDER BY polname;
```

Expected: both regclasses non-null; policies include `player_statuses_auth_read`, `player_statuses_own_insert`, `player_statuses_own_delete`, `player_statuses_staff_delete`.

- [ ] **Step 5: Regenerate types**

From `C:/Users/gorok/Videos/sentinelx` (or wherever the CLI is linked):

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

Copy the regenerated `lib/supabase/types.ts` into this worktree. Confirm it now contains `player_statuses:` and `status_views:` table definitions:

```bash
grep -c "player_statuses:\|status_views:" lib/supabase/types.ts   # expect >= 2
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (no code consumes the new types yet; this just confirms the regenerated file is well-formed).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts
git commit -m "feat(community): staff takedown for statuses + regenerate types

The base statuses migration was never applied to production and had no
staff-delete policy. Adds player_statuses_staff_delete + status_views_staff_read
and applies both migrations.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 2: Status input validation schema (TDD)

**Files:**
- Create: `lib/community/status-schema.ts`
- Test: `lib/community/status-schema.test.ts`

**Interfaces:**
- Produces:
  - `statusCaptionSchema: z.ZodType<string | null>` — trims, empty string → `null`, rejects > 200 chars with `'Keep your caption under 200 characters'`.
  - `validateStatusInput(input: { imageUrl?: string | null; caption?: string | null }): { ok: true; data: { imageUrl: string | null; caption: string | null } } | { ok: false; error: string }` — enforces "image or non-blank caption, not neither". Error strings are user-facing sentences.
- Consumed by: `lib/community/status-actions.ts` (Task 3), `components/community/StatusComposer.tsx` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `lib/community/status-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { statusCaptionSchema, validateStatusInput } from './status-schema'

describe('statusCaptionSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(statusCaptionSchema.parse('  gg  ')).toBe('gg')
  })

  it('turns a blank caption into null', () => {
    expect(statusCaptionSchema.parse('   ')).toBeNull()
    expect(statusCaptionSchema.parse('')).toBeNull()
  })

  it('accepts a 200-character caption', () => {
    const c = 'x'.repeat(200)
    expect(statusCaptionSchema.parse(c)).toBe(c)
  })

  it('rejects a 201-character caption', () => {
    const res = statusCaptionSchema.safeParse('x'.repeat(201))
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/under 200/i)
  })
})

describe('validateStatusInput', () => {
  it('accepts an image with no caption', () => {
    const res = validateStatusInput({ imageUrl: 'https://cdn/x.jpg' })
    expect(res).toEqual({ ok: true, data: { imageUrl: 'https://cdn/x.jpg', caption: null } })
  })

  it('accepts a caption with no image', () => {
    const res = validateStatusInput({ caption: 'up 3-0, easy' })
    expect(res).toEqual({ ok: true, data: { imageUrl: null, caption: 'up 3-0, easy' } })
  })

  it('accepts an image and a caption together', () => {
    const res = validateStatusInput({ imageUrl: 'https://cdn/x.jpg', caption: 'clutch' })
    expect(res).toEqual({ ok: true, data: { imageUrl: 'https://cdn/x.jpg', caption: 'clutch' } })
  })

  it('rejects neither image nor caption', () => {
    const res = validateStatusInput({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/add a photo or write something/i)
  })

  it('rejects a blank-only caption with no image', () => {
    const res = validateStatusInput({ caption: '   ' })
    expect(res.ok).toBe(false)
  })

  it('rejects an over-long caption', () => {
    const res = validateStatusInput({ caption: 'x'.repeat(201) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/under 200/i)
  })

  it('treats a whitespace-only imageUrl as absent', () => {
    const res = validateStatusInput({ imageUrl: '  ', caption: 'hi' })
    expect(res).toEqual({ ok: true, data: { imageUrl: null, caption: 'hi' } })
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `npx vitest run lib/community/status-schema.test.ts`
Expected: FAIL — `Cannot find module './status-schema'`.

- [ ] **Step 3: Implement the schema**

Create `lib/community/status-schema.ts`:

```ts
import { z } from 'zod'

// Mirrors the DB CHECKs on player_statuses:
//   player_statuses_caption_len  -> caption IS NULL OR char_length(caption) <= 200
//   player_statuses_has_content  -> image_url IS NOT NULL OR btrim(caption) <> ''
// This is the friendly-message twin of those constraints, shared by the
// composer (client) and postStatus (server).

export const statusCaptionSchema = z
  .string()
  .trim()
  .max(200, 'Keep your caption under 200 characters')
  .transform((s) => (s.length === 0 ? null : s))

type StatusInput = { imageUrl?: string | null; caption?: string | null }
type StatusInputResult =
  | { ok: true; data: { imageUrl: string | null; caption: string | null } }
  | { ok: false; error: string }

export function validateStatusInput(input: StatusInput): StatusInputResult {
  const imageUrl = typeof input.imageUrl === 'string' && input.imageUrl.trim().length > 0
    ? input.imageUrl.trim()
    : null

  const parsedCaption = statusCaptionSchema.safeParse(input.caption ?? '')
  if (!parsedCaption.success) {
    return { ok: false, error: parsedCaption.error.issues[0].message }
  }
  const caption = parsedCaption.data

  if (!imageUrl && !caption) {
    return { ok: false, error: 'Add a photo or write something first.' }
  }
  return { ok: true, data: { imageUrl, caption } }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npx vitest run lib/community/status-schema.test.ts`
Expected: PASS (12 assertions across the two describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/community/status-schema.ts lib/community/status-schema.test.ts
git commit -m "feat(community): status input validation schema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 3: Data layer — status query + server actions

**Files:**
- Create: `lib/community/status-query.ts`
- Create: `lib/community/status-actions.ts`

**Interfaces:**
- Consumes: `groupIntoRings`, `type StatusRow`, `type StatusRing` from `lib/community/statuses.ts`; `validateStatusInput` from `lib/community/status-schema.ts`; `createClient` from `@/lib/supabase/server`.
- Produces:
  - `fetchStatusRings(viewerId: string | null): Promise<StatusRing[]>` — all live statuses grouped into rings, ordered per `groupIntoRings`.
  - `type StatusViewerRow = { viewerId: string; name: string; username: string | null; avatarUrl: string | null; viewedAt: string }`
  - `fetchStatusViewers(statusId: string): Promise<StatusViewerRow[]>` — RLS returns rows only if the caller authored the status (or is staff); newest first.
  - `postStatus(input: { imageUrl?: string | null; caption?: string | null }): Promise<{ id?: string; error?: string }>`
  - `deleteStatus(id: string): Promise<{ error?: string }>`
  - `recordStatusView(id: string): Promise<void>` — best-effort; never throws.
- Consumed by: `app/[locale]/(public)/community/page.tsx` (Task 7), `StatusComposer` (Task 5), `StatusViewer` (Task 6).

**Note on testing:** `fetchStatusRings` / the actions need a live DB and auth context; this codebase does not unit-test that layer (`feed-query.ts`, `post-actions.ts` have no tests — the pure logic they call, like `groupIntoRings` and `isBoostLive`, is tested separately and already is here). Verify this task by typecheck + the end-to-end run in Task 9.

- [ ] **Step 1: Write `status-query.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import { groupIntoRings, type StatusRing, type StatusRow } from './statuses'

const PROFILE_FIELDS = 'id, username, display_name, avatar_url'

type RawStatus = {
  id: string
  player_id: string
  image_url: string | null
  caption: string | null
  created_at: string
  expires_at: string
  author: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }
    | { id: string; username: string | null; display_name: string | null; avatar_url: string | null }[]
    | null
}

function firstAuthor(a: RawStatus['author']) {
  return Array.isArray(a) ? (a[0] ?? null) : a
}

// Live statuses only — expires_at > now() is the mechanism, not a job. One
// query for the statuses + authors, one for this viewer's own view rows.
export async function fetchStatusRings(viewerId: string | null): Promise<StatusRing[]> {
  const supabase = createClient()
  const nowIso = new Date().toISOString()

  const { data: rows, error } = await supabase
    .from('player_statuses')
    .select(
      `id, player_id, image_url, caption, created_at, expires_at,
       author:profiles!player_statuses_player_id_fkey(${PROFILE_FIELDS})`,
    )
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })

  if (error || !rows || rows.length === 0) return []

  const statuses: StatusRow[] = (rows as unknown as RawStatus[]).map((r) => {
    const a = firstAuthor(r.author)
    return {
      id: r.id,
      playerId: r.player_id,
      imageUrl: r.image_url,
      caption: r.caption,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      authorName: a?.display_name ?? a?.username ?? 'Player',
      authorUsername: a?.username ?? null,
      authorAvatarUrl: a?.avatar_url ?? null,
    }
  })

  let viewedIds = new Set<string>()
  if (viewerId) {
    const statusIds = statuses.map((s) => s.id)
    const { data: views } = await supabase
      .from('status_views')
      .select('status_id')
      .eq('viewer_id', viewerId)
      .in('status_id', statusIds)
    viewedIds = new Set((views ?? []).map((v) => v.status_id))
  }

  return groupIntoRings(statuses, viewedIds, viewerId)
}

export type StatusViewerRow = {
  viewerId: string
  name: string
  username: string | null
  avatarUrl: string | null
  viewedAt: string
}

// RLS (status_views_author_or_self_read + status_views_staff_read) returns rows
// only to the status's author or staff; anyone else gets an empty list.
export async function fetchStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('status_views')
    .select(
      `viewer_id, viewed_at,
       viewer:profiles!status_views_viewer_id_fkey(${PROFILE_FIELDS})`,
    )
    .eq('status_id', statusId)
    .order('viewed_at', { ascending: false })

  type Row = {
    viewer_id: string
    viewed_at: string
    viewer: { username: string | null; display_name: string | null; avatar_url: string | null }
      | { username: string | null; display_name: string | null; avatar_url: string | null }[]
      | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const v = Array.isArray(r.viewer) ? r.viewer[0] : r.viewer
    return {
      viewerId: r.viewer_id,
      name: v?.display_name ?? v?.username ?? 'Player',
      username: v?.username ?? null,
      avatarUrl: v?.avatar_url ?? null,
      viewedAt: r.viewed_at,
    }
  })
}
```

- [ ] **Step 2: Write `status-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateStatusInput } from './status-schema'

export async function postStatus(input: {
  imageUrl?: string | null
  caption?: string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post a status.' }

  const validated = validateStatusInput(input)
  if (!validated.ok) return { error: validated.error }

  const { data, error } = await supabase
    .from('player_statuses')
    .insert({
      player_id: user.id,
      image_url: validated.data.imageUrl,
      caption: validated.data.caption,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[postStatus] insert failed', { userId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post your status. Please try again.' }
  }

  revalidatePath('/community')
  return { id: data.id }
}

export async function deleteStatus(id: string): Promise<{ error?: string }> {
  if (!id) return { error: 'Missing status.' }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  // RLS (player_statuses_own_delete) already restricts this to the author;
  // the explicit check just makes the error friendly instead of a silent no-op.
  const { data: row } = await supabase
    .from('player_statuses')
    .select('player_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { error: 'That status is already gone.' }
  if (row.player_id !== user.id) return { error: 'You can only delete your own status.' }

  const { error } = await supabase.from('player_statuses').delete().eq('id', id)
  if (error) return { error: 'Could not delete this status. Please try again.' }

  revalidatePath('/community')
  return {}
}

// Best-effort. A failure to record a view must never break playback, so this
// swallows everything and returns void. The unique (status_id, viewer_id)
// constraint makes a repeat view a no-op conflict, which we ignore.
export async function recordStatusView(id: string): Promise<void> {
  if (!id) return
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('status_views')
      .upsert({ status_id: id, viewer_id: user.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true })
  } catch {
    // swallow — see comment above
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes. If `player_statuses` / `status_views` are `never`-typed, Task 1 Step 5 (type regen) was not completed — go back and finish it.

- [ ] **Step 4: Lint**

Run: `npx next lint --file lib/community/status-query.ts --file lib/community/status-actions.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/community/status-query.ts lib/community/status-actions.ts
git commit -m "feat(community): status query + post/delete/view server actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 4: `StatusRing` + `StatusTray` components

**Files:**
- Create: `components/community/StatusRing.tsx`
- Create: `components/community/StatusTray.tsx`

**Interfaces:**
- Consumes: `type StatusRing` from `lib/community/statuses.ts`; `Avatar` from `@/components/shared/Avatar` — **its props are `{ avatarUrl, displayName, username, size?: number, className? }`** (server component, no `'use client'`, safe to render inside a client component; `initialsFrom` is its only import). Pass `avatarUrl` + `displayName` (+ `username` for the initials fallback), never a `src` prop.
- Produces:
  - `StatusRing` — `{ name: string; avatarUrl: string | null; unseen: boolean; self?: boolean; onClick: () => void; label?: string }`. A 64px avatar wrapped in a 2px ring: `unseen` → purple gradient (`from-sx-purple to-fuchsia-500`), seen → `border-sx-border`, `self` with no statuses → dashed border + a `+` badge.
  - `type TrayViewer = { id: string; name: string; avatarUrl: string | null }`
  - `StatusTray` — `{ rings: StatusRing[]; viewer: TrayViewer | null }`. Renders a horizontally-scrolling row: the viewer's own entry first (their ring if they have one, else a "Your status" add button), then the rest. Owns which overlay is open (`'composer' | { type: 'viewer'; index: number } | null`) and an optimistic `Set<string>` of status ids seen this session (merged into ring `unseen` display and passed down so a ring greys out the instant its viewer closes).
- Consumed by: `app/[locale]/(public)/community/page.tsx` (Task 7).

**Design (spec §"Components"):** purple ring = unseen, grey = seen, "＋ Your status" entry first. Mobile-first: `overflow-x-auto`, `gap-3`, `px-4`, no scrollbar chrome (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`). The whole tray is hidden when there are no rings **and** no logged-in viewer.

- [ ] **Step 1: Write `StatusRing.tsx`**

```tsx
'use client'
import { Plus } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'

export interface StatusRingProps {
  name: string
  avatarUrl: string | null
  unseen: boolean
  self?: boolean
  /** self && no statuses yet — show a dashed ring + plus badge instead of a live ring. */
  empty?: boolean
  label?: string
  onClick: () => void
}

export function StatusRing({ name, avatarUrl, unseen, self, empty, label, onClick }: StatusRingProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[72px] shrink-0 flex-col items-center gap-1"
      aria-label={label ?? `${name}'s status`}
    >
      <span
        className={cn(
          'relative rounded-full p-[2px]',
          empty
            ? 'border-2 border-dashed border-sx-border'
            : unseen
              ? 'bg-gradient-to-tr from-sx-purple to-fuchsia-500'
              : 'bg-sx-border',
        )}
      >
        <span className="block rounded-full border-2 border-sx-bg">
          <Avatar avatarUrl={avatarUrl} displayName={name} username={name} size={56} />
        </span>
        {empty && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-sx-purple text-white ring-2 ring-sx-bg">
            <Plus className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="max-w-[68px] truncate text-[11px] font-semibold text-sx-gray">
        {label ?? name}
      </span>
    </button>
  )
}
```

> `Avatar` takes a numeric `size` and `avatarUrl` / `displayName` / `username` (confirmed during planning). `HexAvatar` is the tier-ringed hex variant used in the composer; the tray uses the plain circular `Avatar` so the status ring reads clearly.

- [ ] **Step 2: Write `StatusTray.tsx`**

```tsx
'use client'
import { useMemo, useState } from 'react'
import type { StatusRing as StatusRingData } from '@/lib/community/statuses'
import { StatusRing } from './StatusRing'
import { StatusComposer } from './StatusComposer'
import { StatusViewer } from './StatusViewer'

export type TrayViewer = { id: string; name: string; avatarUrl: string | null }

type Overlay = { kind: 'composer' } | { kind: 'viewer'; index: number } | null

export function StatusTray({ rings, viewer }: { rings: StatusRingData[]; viewer: TrayViewer | null }) {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [seenThisSession, setSeenThisSession] = useState<Set<string>>(new Set())

  const ownRingIndex = rings.findIndex((r) => r.isSelf)
  const hasOwnRing = ownRingIndex >= 0

  // Apply this session's optimistic views on top of the server's hasUnseen.
  // Your own ring is never "unseen" — groupIntoRings reports hasUnseen:true for
  // it (you never record views of your own statuses), but WhatsApp-style your
  // ring shows neutral, not a nag.
  const displayRings = useMemo(
    () =>
      rings.map((r) => ({
        ...r,
        displayUnseen:
          !r.isSelf && r.hasUnseen && r.statuses.some((s) => !seenThisSession.has(s.id)),
      })),
    [rings, seenThisSession],
  )

  if (rings.length === 0 && !viewer) return null

  function markSeen(ids: string[]) {
    setSeenThisSession((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
  }

  return (
    <div className="mb-6">
      <div className="flex gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {viewer && !hasOwnRing && (
          <StatusRing
            name={viewer.name}
            avatarUrl={viewer.avatarUrl}
            unseen={false}
            self
            empty
            label="Your status"
            onClick={() => setOverlay({ kind: 'composer' })}
          />
        )}
        {displayRings.map((r, i) => (
          <StatusRing
            key={r.playerId}
            name={r.isSelf ? 'Your status' : r.authorName}
            avatarUrl={r.authorAvatarUrl}
            unseen={r.displayUnseen}
            self={r.isSelf}
            label={r.isSelf ? 'Your status' : undefined}
            onClick={() => setOverlay({ kind: 'viewer', index: i })}
          />
        ))}
        {/* When the viewer already has a ring, give them an explicit "add" affordance too. */}
        {viewer && hasOwnRing && (
          <StatusRing
            name="Add"
            avatarUrl={viewer.avatarUrl}
            unseen={false}
            self
            empty
            label="Add"
            onClick={() => setOverlay({ kind: 'composer' })}
          />
        )}
      </div>

      {overlay?.kind === 'composer' && <StatusComposer onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'viewer' && (
        <StatusViewer
          rings={rings}
          startIndex={overlay.index}
          viewerId={viewer?.id ?? null}
          onSeen={markSeen}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails only on the not-yet-created `./StatusComposer` and `./StatusViewer` imports. That is acceptable at this step — Tasks 5 and 6 create them. If you prefer a green checkpoint, stub both as `export function StatusComposer(_: { onClose: () => void }) { return null }` / `export function StatusViewer(_: { rings: unknown[]; startIndex: number; viewerId: string | null; onSeen: (ids: string[]) => void; onClose: () => void }) { return null }` and replace in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add components/community/StatusRing.tsx components/community/StatusTray.tsx
git commit -m "feat(community): status ring + tray shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 5: `StatusComposer`

**Files:**
- Create: `components/community/StatusComposer.tsx`

**Interfaces:**
- Consumes: `postStatus` from `lib/community/status-actions.ts`; `validateStatusInput` from `lib/community/status-schema.ts`; `resizeImageToMaxWidth` from `@/lib/media/resize-image`; `createClient` from `@/lib/supabase/client`.
- Produces: `StatusComposer` — `{ onClose: () => void }`. Full-screen sheet (mobile) / centered modal (desktop): one optional image, one optional caption (≤ 200, live counter), "Share status" button disabled until `validateStatusInput` passes. On submit: resize → upload to `community-images` at `${user.id}/statuses/${crypto.randomUUID()}.jpg` → `postStatus({ imageUrl, caption })` → `router.refresh()` → `onClose()`.
- Consumed by: `StatusTray` (Task 4).

**Pattern:** near-identical to `components/community/PostComposer.tsx` — copy its structure (Esc-to-close, `body.overflow` lock, image-only-on-submit, `useTransition`). Differences: caption limit 200 not 500, `maxWidth = 1080`, storage path has the `statuses/` sub-prefix, button label "Share status", and the client-side `canPost` uses `validateStatusInput`.

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToMaxWidth } from '@/lib/media/resize-image'
import { postStatus } from '@/lib/community/status-actions'
import { validateStatusInput } from '@/lib/community/status-schema'

const MAX_CHARS = 200

export function StatusComposer({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function removeImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
  }

  const canPost =
    validateStatusInput({ imageUrl: file ? 'pending' : null, caption }).ok && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canPost) return
    setError(null)

    startTransition(async () => {
      let imageUrl: string | null = null
      if (file) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError('Please log in.')
          return
        }
        try {
          const resized = await resizeImageToMaxWidth(file, 1080)
          const path = `${user.id}/statuses/${crypto.randomUUID()}.jpg`
          const { error: upErr } = await supabase.storage
            .from('community-images')
            .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          imageUrl = supabase.storage.from('community-images').getPublicUrl(path).data.publicUrl
        } catch {
          setError('That image failed to upload. Please try again.')
          return
        }
      }

      const res = await postStatus({ imageUrl, caption })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="New status" className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full sm:max-w-md sm:px-4">
        <form
          onSubmit={onSubmit}
          className="max-h-[90vh] overflow-y-auto rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:rounded-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-black uppercase tracking-widest text-sx-white">New Status</p>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-sx-gray hover:text-sx-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-sx-gray">Disappears after 24 hours.</p>

          {previewUrl ? (
            <div className="relative mt-4 overflow-hidden rounded-xl border border-sx-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="" className="max-h-[50vh] w-full object-contain bg-black" />
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove image"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="mt-4 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-sx-border text-sx-gray hover:border-sx-purple/50 hover:text-sx-white">
              <ImagePlus className="h-6 w-6" />
              <span className="text-xs font-bold">Add a photo (optional)</span>
              <input ref={inputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            </label>
          )}

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            maxLength={MAX_CHARS}
            placeholder="Say something…"
            className="mt-3 w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
          />
          <p className="mt-1 text-right text-[11px] text-sx-gray">{caption.length} / {MAX_CHARS}</p>

          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-sx-gray hover:text-sx-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canPost}
              className="rounded-lg bg-sx-purple px-5 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
            >
              {pending ? 'Sharing…' : 'Share status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file components/community/StatusComposer.tsx`
Expected: passes (the `StatusViewer` import in `StatusTray` still fails until Task 6 — ignore that one).

- [ ] **Step 3: Commit**

```bash
git add components/community/StatusComposer.tsx
git commit -m "feat(community): status composer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 6: `StatusViewer`

**Files:**
- Create: `components/community/StatusViewer.tsx`

**Interfaces:**
- Consumes: `type StatusRing`, `type StatusRow` from `lib/community/statuses.ts`; `recordStatusView`, `deleteStatus` from `lib/community/status-actions.ts`; `fetchStatusViewers`, `type StatusViewerRow` from `lib/community/status-query.ts`; `Avatar`; `formatRelativeTime` from `@/lib/format`.
- Produces: `StatusViewer` — `{ rings: StatusRing[]; startIndex: number; viewerId: string | null; onSeen: (ids: string[]) => void; onClose: () => void }`. Full-screen black overlay showing one ring at a time, its statuses played oldest→newest (the ring's `statuses` are already in that order). Segment progress bars across the top. Tap right half → next segment (roll into next ring, then `onClose` past the last); tap left half → previous. Auto-advance after `SEGMENT_MS` (5000). Records a view (`recordStatusView` + `onSeen([id])`) when a segment becomes visible. `X` / Escape / swipe-down closes. When the current status is the viewer's own: show a "👁 N" viewers control that opens a bottom sheet listing `fetchStatusViewers` results, plus a "Delete" action (`deleteStatus` → advance/close → `router.refresh()`).
- Consumed by: `StatusTray` (Task 4).

**Behaviour detail (spec §"Components"):**
- "Records a view on open of each segment" — call once per distinct status id per mount (track a `Set`).
- Auto-advance pauses while the viewer holds a press (pointer-down) — this is also how they read a long caption.
- Do not record a view for the viewer's **own** statuses (they authored them) — skip `recordStatusView` when `rings[ringIdx].isSelf`.

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Eye, Trash2 } from 'lucide-react'
import type { StatusRing } from '@/lib/community/statuses'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import { recordStatusView, deleteStatus } from '@/lib/community/status-actions'
import { fetchStatusViewers, type StatusViewerRow } from '@/lib/community/status-query'

const SEGMENT_MS = 5000
const TICK_MS = 50

export function StatusViewer({
  rings,
  startIndex,
  viewerId,
  onSeen,
  onClose,
}: {
  rings: StatusRing[]
  startIndex: number
  viewerId: string | null
  onSeen: (ids: string[]) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [ringIdx, setRingIdx] = useState(startIndex)
  const [segIdx, setSegIdx] = useState(0)
  const [progress, setProgress] = useState(0) // 0..1 within the current segment
  const [paused, setPaused] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<StatusViewerRow[]>([])
  const recorded = useRef<Set<string>>(new Set())

  const ring = rings[ringIdx]
  const status = ring?.statuses[segIdx]

  const close = useCallback(() => onClose(), [onClose])

  const goNext = useCallback(() => {
    setProgress(0)
    setSegIdx((s) => {
      if (ring && s + 1 < ring.statuses.length) return s + 1
      // roll into the next ring
      setRingIdx((r) => {
        if (r + 1 < rings.length) return r + 1
        close()
        return r
      })
      return 0
    })
  }, [ring, rings.length, close])

  const goPrev = useCallback(() => {
    setProgress(0)
    setSegIdx((s) => {
      if (s > 0) return s - 1
      setRingIdx((r) => (r > 0 ? r - 1 : r))
      return 0
    })
  }, [])

  // Record a view once per status (skip the viewer's own ring).
  useEffect(() => {
    if (!status) return
    if (recorded.current.has(status.id)) return
    recorded.current.add(status.id)
    if (!ring.isSelf && viewerId) {
      void recordStatusView(status.id)
      onSeen([status.id])
    }
  }, [status, ring, viewerId, onSeen])

  // Auto-advance timer.
  useEffect(() => {
    if (!status || paused || showViewers) return
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + TICK_MS / SEGMENT_MS
        if (next >= 1) {
          clearInterval(id)
          goNext()
          return 0
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [status, paused, showViewers, goNext])

  // Escape to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [close, goNext, goPrev])

  async function openViewers() {
    if (!status) return
    setShowViewers(true)
    setViewers(await fetchStatusViewers(status.id))
  }

  async function onDelete() {
    if (!status) return
    const res = await deleteStatus(status.id)
    if (res.error) {
      alert(res.error) // simple; matches the low-frequency, author-only path
      return
    }
    router.refresh()
    // Drop the deleted segment locally by advancing.
    goNext()
  }

  if (!ring || !status) return null

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={`${ring.authorName}'s status`}>
      {/* progress bars */}
      <div className="flex gap-1 p-2">
        {ring.statuses.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full bg-white"
              style={{ width: `${i < segIdx ? 100 : i === segIdx ? progress * 100 : 0}%` }}
            />
          </div>
        ))}
      </div>

      {/* header */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <Avatar avatarUrl={ring.authorAvatarUrl} displayName={ring.authorName} username={ring.authorUsername} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{ring.isSelf ? 'Your status' : ring.authorName}</p>
          <p className="text-[11px] text-white/60">{formatRelativeTime(status.createdAt)}</p>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="ml-auto rounded-lg p-1 text-white/80 hover:text-white">
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* content + tap zones */}
      <div
        className="relative flex-1"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {status.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={status.imageUrl} alt={status.caption ?? ''} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-sx-purple/40 to-black p-8">
            <p className="text-center text-xl font-bold text-white">{status.caption}</p>
          </div>
        )}
        {status.imageUrl && status.caption && (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-8 text-center text-sm text-white">
            {status.caption}
          </p>
        )}
        {/* invisible tap targets */}
        <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={goPrev} />
        <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 w-2/3" onClick={goNext} />
      </div>

      {/* own-status footer: viewers + delete */}
      {ring.isSelf && (
        <div className="flex items-center justify-between px-4 py-3">
          <button type="button" onClick={openViewers} className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
            <Eye className="h-4 w-4" /> Seen by
          </button>
          <button type="button" onClick={onDelete} className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}

      {/* seen-by sheet */}
      {showViewers && (
        <div className="absolute inset-0 z-10 flex items-end bg-black/60" onClick={() => setShowViewers(false)}>
          <div className="max-h-[60vh] w-full overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-black uppercase tracking-widest text-sx-white">Seen by {viewers.length}</p>
            {viewers.length === 0 ? (
              <p className="py-6 text-center text-xs text-sx-gray">No views yet.</p>
            ) : (
              <ul className="space-y-2">
                {viewers.map((v) => (
                  <li key={v.viewerId} className="flex items-center gap-2.5">
                    <Avatar avatarUrl={v.avatarUrl} displayName={v.name} username={v.username} size={28} />
                    <span className="text-sm text-sx-white">{v.name}</span>
                    <span className="ml-auto text-[11px] text-sx-gray">{formatRelativeTime(v.viewedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

> `fetchStatusViewers` is a server function imported into a client component — that is fine because `status-query.ts` has no `'use server'` and Next will not bundle `@/lib/supabase/server` into the client only if it is actually reachable. **It is reachable here.** Change `fetchStatusViewers` into a `'use server'` action instead: add a thin wrapper `getStatusViewers(statusId)` in `status-actions.ts` that calls the query, and import that. Do this during Task 6 — do not import `status-query.ts` from the client.

- [ ] **Step 2: Add the `getStatusViewers` server action**

In `lib/community/status-actions.ts` add:

```ts
import { fetchStatusViewers, type StatusViewerRow } from './status-query'

export async function getStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  if (!statusId) return []
  return fetchStatusViewers(statusId)
}
```

And in `StatusViewer.tsx` import `getStatusViewers` (+ `type StatusViewerRow` — re-export it from `status-actions.ts` or import the type from `status-query.ts`, types are erased so a type-only import from the query file is safe) instead of `fetchStatusViewers`.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file components/community/StatusViewer.tsx --file components/community/StatusTray.tsx`
Expected: passes. The whole `StatusTray` → `StatusComposer`/`StatusViewer` tree now resolves.

- [ ] **Step 4: Commit**

```bash
git add components/community/StatusViewer.tsx lib/community/status-actions.ts
git commit -m "feat(community): full-screen status viewer with seen-by list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 7: Wire the tray into `/community` + realtime

**Files:**
- Modify: `app/[locale]/(public)/community/page.tsx`
- Modify: `components/community/CommunityRealtime.tsx`

**Interfaces:**
- Consumes: `fetchStatusRings` from `lib/community/status-query.ts`; `StatusTray`, `type TrayViewer` from `components/community/StatusTray.tsx`.
- Produces: the tray renders above the feed on `/community`; a new or deleted `player_statuses` row triggers `router.refresh()`.

- [ ] **Step 1: Add the fetch + render to the page**

In `app/[locale]/(public)/community/page.tsx`:

1. Import:
   ```ts
   import { fetchStatusRings } from '@/lib/community/status-query'
   import { StatusTray, type TrayViewer } from '@/components/community/StatusTray'
   ```
2. Add `fetchStatusRings(viewerId)` to the existing `Promise.all([...])` (bind its result as `statusRings`).
3. Build the tray viewer from the already-fetched `viewerProfile` (it is `ComposerViewer | null` with `avatarUrl`, `username`, `displayName`, `membershipTier`):
   ```ts
   const trayViewer: TrayViewer | null = viewerId
     ? {
         id: viewerId,
         name: viewerProfile?.displayName ?? viewerProfile?.username ?? 'You',
         avatarUrl: viewerProfile?.avatarUrl ?? null,
       }
     : null
   ```
4. Render `<StatusTray rings={statusRings} viewer={trayViewer} />` immediately after `<CommunityHero />`'s wrapper `</div>` and before the `<CommunityStatsBar>` block, so it sits directly under the hero. (Confirm placement reads well at 375px in Task 9; the spec says "at the top of `/community`".)

- [ ] **Step 2: Extend `CommunityRealtime`**

In `components/community/CommunityRealtime.tsx`, after the `for (const table of ['post_comments', 'post_reactions'] ...)` loop, add a separate subscription (statuses are not post-scoped, so this only runs on the feed where `postId` is undefined):

```ts
if (!postId) {
  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'player_statuses' },
    scheduleRefresh,
  )
  channel.on(
    'postgres_changes',
    { event: 'DELETE', schema: 'public', table: 'player_statuses' },
    scheduleRefresh,
  )
}
```

Do **not** subscribe to `status_views` — a view fires on every segment watched and the tray's seen-state is already optimistic client-side; refreshing the whole page per view would be wasteful and janky.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file "app/[locale]/(public)/community/page.tsx" --file components/community/CommunityRealtime.tsx`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/community/page.tsx" components/community/CommunityRealtime.tsx
git commit -m "feat(community): render status tray on the feed + realtime

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 8: Admin moderation surface

**Files:**
- Modify: `lib/community/admin-query.ts`
- Modify: `lib/community/admin-actions.ts`
- Create: `components/admin/AdminStatusList.tsx`
- Modify: `app/[locale]/admin/community/page.tsx`

**Interfaces:**
- Consumes: `requireStaff` from `@/lib/admin/auth`; `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`.
- Produces:
  - `type AdminStatusRow = { id: string; caption: string | null; imageUrl: string | null; createdAt: string; expiresAt: string; authorUsername: string | null; viewCount: number }`
  - `fetchAdminStatuses(limit?: number): Promise<AdminStatusRow[]>` — live statuses (`expires_at > now()`), newest first.
  - `adminDeleteStatus(_prev: AdminActionState, formData: FormData): Promise<AdminActionState>` — staff hard-delete of any status (`id` from form). Uses the service-role client to sidestep needing the RLS `player_statuses_staff_delete` path from a server action context, mirroring `adminDeletePost`.
  - `AdminStatusList` — `{ statuses: AdminStatusRow[] }` client component with a confirm-then-delete control per row (mirror `AdminPostRow`'s two-step delete).
- Consumed by: `app/[locale]/admin/community/page.tsx`.

- [ ] **Step 1: `fetchAdminStatuses` in `admin-query.ts`**

```ts
export interface AdminStatusRow {
  id: string
  caption: string | null
  imageUrl: string | null
  createdAt: string
  expiresAt: string
  authorUsername: string | null
  viewCount: number
}

export async function fetchAdminStatuses(limit = 60): Promise<AdminStatusRow[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_statuses')
    .select('id, caption, image_url, created_at, expires_at, author:profiles!player_statuses_player_id_fkey(username)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (data ?? []) as unknown as {
    id: string; caption: string | null; image_url: string | null; created_at: string; expires_at: string
    author: { username: string | null } | { username: string | null }[] | null
  }[]
  if (rows.length === 0) return []

  const { data: views } = await supabase
    .from('status_views')
    .select('status_id')
    .in('status_id', rows.map((r) => r.id))
  const countById = new Map<string, number>()
  for (const v of views ?? []) countById.set(v.status_id, (countById.get(v.status_id) ?? 0) + 1)

  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    imageUrl: r.image_url,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    authorUsername: (Array.isArray(r.author) ? r.author[0]?.username : r.author?.username) ?? null,
    viewCount: countById.get(r.id) ?? 0,
  }))
}
```

> The `status_views` staff read needs the `status_views_staff_read` policy from Task 1. If the count comes back 0 for everything during Task 9, that policy did not apply — re-check Task 1 Step 4.

- [ ] **Step 2: `adminDeleteStatus` in `admin-actions.ts`**

```ts
export async function adminDeleteStatus(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing status.' }

  const admin = createAdminClient()
  const { error } = await admin.from('player_statuses').delete().eq('id', id)
  if (error) return { error: 'Could not delete this status.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}
```

- [ ] **Step 3: `AdminStatusList.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { adminDeleteStatus, type AdminActionState } from '@/lib/community/admin-actions'
import type { AdminStatusRow } from '@/lib/community/admin-query'

export function AdminStatusList({ statuses }: { statuses: AdminStatusRow[] }) {
  if (statuses.length === 0) {
    return <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No live statuses.</p>
  }
  return (
    <div className="space-y-2">
      {statuses.map((s) => (
        <AdminStatusRowItem key={s.id} status={s} />
      ))}
    </div>
  )
}

function AdminStatusRowItem({ status }: { status: AdminStatusRow }) {
  const [state, action] = useFormState<AdminActionState, FormData>(adminDeleteStatus, undefined)
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {status.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">
              {status.authorUsername ?? 'Player'} · {formatDateTime(status.createdAt)} · 👁 {status.viewCount}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-200">{status.caption ?? <span className="text-slate-500">(image only)</span>}</p>
          </div>
        </div>
        {!confirm ? (
          <button type="button" onClick={() => setConfirm(true)} className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
            Delete
          </button>
        ) : (
          <form action={action} className="shrink-0">
            <input type="hidden" name="id" value={status.id} />
            <button type="submit" className="text-xs font-bold text-red-400 hover:text-red-300">Confirm</button>
          </form>
        )}
      </div>
      {state?.error && <p className="mt-1 text-[11px] text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Add the section to the admin page**

In `app/[locale]/admin/community/page.tsx`:
- import `fetchAdminStatuses` and `AdminStatusList`
- add `fetchAdminStatuses()` to the `Promise.all`
- add, after the "recent posts" `<section>`:
  ```tsx
  <section>
    <h2 className="mb-3 text-base font-bold text-white">Statuses — live</h2>
    <AdminStatusList statuses={statuses} />
  </section>
  ```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint --file lib/community/admin-query.ts --file lib/community/admin-actions.ts --file components/admin/AdminStatusList.tsx --file "app/[locale]/admin/community/page.tsx"`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add lib/community/admin-query.ts lib/community/admin-actions.ts components/admin/AdminStatusList.tsx "app/[locale]/admin/community/page.tsx"
git commit -m "feat(community): admin moderation surface for live statuses

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
```

---

## Task 9: End-to-end verification

**Files:** none — this is a manual run in the deployed preview (per the Global Constraints, do not `npm run build` locally while concurrent `next dev` may be running; push the branch and use the Vercel preview).

- [ ] **Step 1: Push and open the preview**

```bash
git push -u origin feat/community-statuses
```

Wait for the Vercel preview deploy. Open `/community` signed in as **Account A**.

- [ ] **Step 2: Full unit-test sweep**

Run: `npx vitest run lib/community/`
Expected: all green, including the pre-existing `statuses.test.ts` (11) and the new `status-schema.test.ts`.

- [ ] **Step 3: Post a status (Account A)**
- Tray shows "Your status" with a dashed ring + `+`.
- Tap → composer opens. Add a caption only, Share → composer closes, tray now shows your ring (grey, since it is yours).
- Post a second status with an image + caption.

- [ ] **Step 4: View as Account B**
- Open `/community` as Account B (different browser/incognito). Account A's ring shows with a **purple** (unseen) ring.
- Tap it → viewer opens, plays both segments oldest-first with progress bars, auto-advances, then closes at the end.
- Back on the feed the ring is now **grey** without a manual reload (optimistic), and still grey after a real reload (persisted `status_views`).
- Hold a press → auto-advance pauses; release → resumes.

- [ ] **Step 5: Seen-by (Account A)**
- As Account A, open your own status → footer shows "Seen by", tap → sheet lists Account B with a relative timestamp.
- "Delete" on a segment → it disappears from your ring; feed refreshes.

- [ ] **Step 6: Realtime**
- Two windows on `/community` (A and B). A posts a status → B's tray gains the ring within ~1s (no reload).

- [ ] **Step 7: Expiry (no job)**
- In the Supabase SQL editor: `UPDATE player_statuses SET expires_at = now() - interval '1 minute' WHERE id = '<a status id>';`
- Reload `/community` → that status is gone from the tray and viewer. Confirm **no cron/cleanup was run** — the filter alone did it.

- [ ] **Step 8: Moderation**
- As a staff account, open `/admin/community` → "Statuses — live" lists the remaining statuses with view counts.
- Delete one → gone from `/admin/community` and from `/community` for all accounts.

- [ ] **Step 9: Mobile layout (375px)**
- With devtools at 375px wide (signed in — layout bugs here have historically only reproduced signed in): tray scrolls horizontally without pushing the page wide; composer is a bottom sheet; viewer is full-screen with tappable left/right thirds; seen-by sheet does not overflow. No horizontal body scroll anywhere.

- [ ] **Step 10: Update the progress ledger and the spec status line**
- Tick every box in this plan.
- In `docs/superpowers/specs/2026-09-07-statuses-design.md`, update the `**Status:**` line from "schema and ring logic already built and committed; UI remains" to "shipped <date>".
- Commit:
  ```bash
  git add docs/superpowers/
  git commit -m "docs(community): statuses shipped — update spec status

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01S2qGmJm4jvH6UR9ZyNY6wo"
  ```

- [ ] **Step 11: Merge to main**

Per the user's standing preference (memory `feedback_always_push`): once verified, merge `feat/community-statuses` into `main` and push `origin/main` — do not run the finishing-a-development-branch menu.

```bash
git checkout main && git pull && git merge --no-ff feat/community-statuses && git push origin main
```

Then confirm the Vercel production deploy is green and re-run Steps 3–8 once against production.

---

## Self-Review

**Spec coverage (`2026-09-07-statuses-design.md`):**

| Spec item | Task |
|---|---|
| Schema (`player_statuses`, `status_views`) — built, but apply + staff policy | 1 |
| Ring logic (`groupIntoRings`) — already built & tested | — (consumed in 3, 4) |
| `postStatus` / `deleteStatus` / `recordStatusView` server actions | 3 |
| zod validation mirroring DB constraints | 2 |
| `StatusTray` — ringed avatars, purple unseen / grey seen, "＋ Your status" first | 4 |
| `StatusComposer` — image + caption, reuses PostComposer upload path under `statuses/` prefix | 5 |
| `StatusViewer` — full-screen, segment progress bars, tap advance/back, auto-advance, swipe/Esc close, records view per segment | 6 |
| Author sees viewer count → seen-by list | 6 |
| Page wiring — `/community` loads live statuses + own view rows, builds rings, renders tray above feed | 7 |
| Realtime — new status appears without reload | 7 |
| Moderation — "same reporting route as posts"; posts have staff visibility + delete, so statuses get an admin list + staff delete | 1, 8 |
| Expiry is a query filter, verified with no job run | 3 (`gt('expires_at', now)`), 9 Step 7 |
| Immutability — no update path | enforced by DB (no UPDATE policy); no edit UI built |
| Cuttable corner (seen-by list) | built; noted as the first thing to cut if time-pressured |

**Overview spec cross-cutting:** storage reuses `community-images` with a `statuses/` sub-prefix (Global Constraints); realtime uses `ALTER PUBLICATION` (already in the base migration) + RLS; moderation reaches the existing admin surface (`/admin/community`), no new inbox; nothing depends on a scheduled job.

**Placeholder scan:** no TBD/TODO; every code step has literal code. The two "check the real prop names" notes (`Avatar` size prop in Task 4/6) are deliberate — `Avatar.tsx` was not read during planning; the executor confirms the signature and adjusts the one prop. Not a blocker to any logic.

**Type consistency:** `StatusRow` / `StatusRing` come from the existing `lib/community/statuses.ts` and are used unchanged. `TrayViewer` (Task 4) is built from `viewerProfile` in Task 7. `AdminStatusRow` defined in Task 8 Step 1, consumed in Steps 3–4. `getStatusViewers` (Task 6 Step 2) wraps `fetchStatusViewers` (Task 3) — client never imports `status-query.ts` for a value, only the type.

**Known deviation from spec:** spec says the migration is "already applied" — it is not (Task 1 fixes this) and it lacks a staff-delete policy (Task 1 adds one). Both were confirmed against the live remote migration history and the base migration DDL during planning.
