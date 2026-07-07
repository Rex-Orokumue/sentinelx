# Admin Tournament Management (CRUD) — Design (#9 sub-project 2 of 6)

**Route:** `/admin/tournaments`
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Context

Second of the six Admin Dashboard sub-projects (see the admin-shell spec). Builds directly on
sub-project 1's shell: the `requireStaff`/`requireAdmin` helpers (`lib/admin/auth.ts`) and the
nav registry (`lib/admin/nav.ts`). **No DB migration** — the `tournaments` and `games` tables,
their FK, and the RLS policies already exist.

Scope boundary with later sub-projects: this owns tournament **create / edit / delete** and the
**publish** transition (`draft → registration_open`). It does NOT own closing registration
(`→ registration_closed`, which triggers bracket generation — sub-project 3) or marking a
tournament completed (follows verified results — sub-project 5). Each status transition lives
with the logic it triggers.

## Purpose

Give staff a `/admin/tournaments` surface to create, edit, delete, and publish tournaments,
enforced server-side, so the next tournament can be configured and opened for registration.

## Verified schema facts

- `tournaments.game_id` is a **NOT NULL FK to `public.games(id)`** — games is a real table, not
  an enum. The create/edit form's game selector queries `games` where `active = true`.
- `tournaments.format` defaults to `group_knockout` (the only v1 format).
- `tournaments.status` enum: `draft | registration_open | registration_closed | active |
  completed`. New tournaments start `draft`.
- `tournament_registrations`, `groups`, and `matches` reference `tournaments`
  **`ON DELETE CASCADE`**.
- The stack is React 18 / Next 14.2.35 — forms use `useFormState` from `react-dom` (matching all
  existing forms), **not** `useActionState`.

## Role model (matches existing RLS)

- Create / edit / publish → `requireStaff()` (admin **and** moderator; `tournaments_staff_insert`
  / `tournaments_staff_update`).
- Delete → `requireAdmin()` (`tournaments_admin_delete`).

## Pages — `app/admin/tournaments/`

- **`/admin/tournaments`** — lists **all** tournaments across **every** status (including
  `draft`, unlike the public listing). This is the admin's operational surface for the whole
  lifecycle; later sub-projects hang their actions off this same list, so scoping it narrower now
  would only mean changing the query later. Each row shows title, game, a status badge, and
  role/status-aware actions:
  - **Edit** (staff, any status).
  - **Open registration** (staff, only when `status = 'draft'` AND `missingForPublish` is empty;
    otherwise shown disabled with the missing-fields reason).
  - **Delete** (admin, only when `status = 'draft'`).
- **`/admin/tournaments/new`** — create form. If no active game exists, it shows a "seed a game
  first" message instead of a broken selector (game seeding is a data prerequisite; there is no
  game-admin UI in v1).
- **`/admin/tournaments/[id]/edit`** — edit form.
- Append `{ label: 'Tournaments', href: '/admin/tournaments', adminOnly: false }` to `ADMIN_NAV`.

## Form + validation — `lib/tournaments/admin-schema.ts` (zod)

`tournamentSchema` fields:
- `title` — required, trimmed, 1–120 chars.
- `gameId` — required uuid.
- `description` — optional, max 2000.
- `bannerUrl` — optional; empty string or a valid `http(s)` URL.
- `registrationFee` — coerced int, 0–1_000_000, default 500.
- `prizePool` — coerced int, 0–1_000_000_000, default 0.
- `maxPlayers` — optional coerced int, 2–64 (the grouping table tops out at 64).
- `registrationStart`, `registrationEnd`, `tournamentStart`, `tournamentEnd` — optional; each
  an empty string or an ISO datetime string.
- `slug` — see below.

`format` is not a form field (fixed `group_knockout`). `status` is never in the form — it is set
by `createTournament` (→ `draft`) and `openRegistration`.

## Slug — `lib/tournaments/slug.ts` (pure, unit-tested)

- `slugify(title: string): string` — lowercase; spaces/underscores → single hyphen; strip
  characters outside `[a-z0-9-]`; collapse repeated hyphens; trim leading/trailing hyphens.
- The create action derives the slug from `title` (or a supplied slug), then inserts; on a
  Postgres `23505` unique violation it appends a short random suffix (`-<base36>`) and retries a
  bounded number of times (same 23505 pattern used by signup).
- **Slug is editable only while `draft`; locked after publish** (changing it breaks public URLs +
  SEO). The form receives a `slugLocked` boolean: when true, the slug renders as a **visible
  read-only input** with a "Locked — changing would break public URLs" note (the admin still
  needs to *see* the public URL, so it is read-only, never hidden).

## Readiness — `lib/tournaments/readiness.ts` (pure, unit-tested)

`missingForPublish(t): string[]` returns human-readable labels for each required-to-publish field
that is absent: **game**, **max players**, **registration fee**, **prize pool**, and **at least
one scheduled date** (any of the four date fields present). Returns `[]` when ready.

Consumed by (1) the `openRegistration` action — blocks the transition and returns the list if
non-empty — and (2) the list UI — to disable the "Open registration" button and show the reason.

## Server actions — `lib/tournaments/admin-actions.ts`

All return `{ error?: string; fieldErrors?: string[]; success?: boolean }`-style state and
`revalidatePath('/admin/tournaments')` plus the affected public paths (`/tournaments` and, on
edit/publish, `/tournaments/[slug]`).

- `createTournament` (requireStaff) — validate with `tournamentSchema`; `slugify`; insert with
  `status='draft'`, `format='group_knockout'`; retry on `23505`. Redirect to the edit page.
- `updateTournament` (requireStaff) — validate; if the tournament is not `draft`, ignore any slug
  change (keep the stored slug); otherwise apply the (re-slugified) slug with the same 23505
  retry.
- `deleteTournament` (**requireAdmin**) — **re-fetch the row and refuse unless `status='draft'`**
  (the hidden button is UX only; this server check is the real gate). On success the CASCADE
  cleanly removes any groups/matches/accidental draft registrations.
- `openRegistration` (requireStaff) — re-fetch; refuse unless `status='draft'`; compute
  `missingForPublish`; if non-empty return `{ fieldErrors }`; else set `status='registration_open'`.

**Delete-safety rationale (documented in the action + spec):** the schema's `ON DELETE CASCADE`
is safe *because* deletion is reachable only in `draft` — a state with no paid registrations, no
matches, no results, and no public/SEO footprint. A future dev must not read the cascade as
"delete is safe in any status"; the draft-only guard is what makes it safe.

## Components — `components/admin/`

- `TournamentForm.tsx` (`"use client"`, `useFormState`) — shared by create and edit. Props
  include the action, initial values, the active-games list, and `slugLocked`. Renders the slug
  field per the lock state.
- `TournamentListRow.tsx` — one row: title, game, status badge, and the role/status-aware Edit /
  Open-registration / Delete actions.

## Security

- Every mutation is a Server Action gated by `requireStaff`/`requireAdmin` and, for
  delete/publish, an independent server-side **status re-check** — never trusting the UI.
- RLS on `tournaments` independently enforces staff-insert/update and admin-delete at the DB.

## Testing

Vitest:
- `lib/tournaments/slug.ts` — `slugify` handles spaces, punctuation, mixed case, leading/trailing
  and repeated separators, and non-URL-safe/unicode characters.
- `lib/tournaments/readiness.ts` — each individual missing field is reported; a fully-populated
  tournament returns `[]`; a tournament with only one of the four dates counts as having a date.

Server actions are I/O-bound (Supabase + `redirect`/`revalidatePath`) and are exercised via the
build and manual admin testing.

## Consistency notes

- Mobile-first; the list stacks at 375px, the form is single-column.
- Reuses the shell's `requireStaff`/`requireAdmin` and appends to `ADMIN_NAV` — no new auth or nav
  mechanism.
- Do NOT mark roadmap #9 done (sub-project 2 of 6).
