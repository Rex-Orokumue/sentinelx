# AGENTS.md

Instructions for coding agents (Codex and others) working in this repository.

**Read `CLAUDE.md` in this directory first. Everything in it binds you.** It was written for Claude Code, but its
rules are repo rules. The ones most likely to bite, restated:

## Hard rules

1. **Sensitive tables are written only by the service role** (`profiles`, `tournament_registrations`,
   `withdrawal_requests`, `match_results`, `friendly_matches`, `friendly_match_results`). Use `createAdminClient()` only
   after verifying the caller. Never add an INSERT/UPDATE/DELETE grant for `anon`/`authenticated` on them.
2. **Never `select('*')` on `profiles`.** Anon/authenticated can read only the allow-listed columns from
   `supabase/migrations/20260918200000_lock_down_profiles_and_write_paths.sql`. Private columns: `phone`,
   `whatsapp_number`, `notification_prefs`, `referred_by`, `deletion_requested_at`.
3. **Mobile API endpoints** live under `/api/mobile/v1` and are defined **only** with `defineEndpoint()`
   (`lib/mobile-api/define-endpoint.ts`). Never hand-write a route handler under `app/api/mobile/v1/**`; the route file
   is `export const GET = someEndpoint.handler`. After adding/changing an endpoint run `npm run openapi` **last** and
   commit `openapi/mobile-v1.json`. Money/score/state-creating POSTs need `idempotent: true`.
4. **Migrations** are named with a UTC timestamp prefix (`20260924143000_add_thing.sql`), never the next sequential
   number. Never apply migrations to production; staging is the Supabase project `sentinelx-staging`
   (`ofxmoxpvwbemfouaowoa`).
5. **Every SX Score change writes a row to `sx_score_events`.** Bracket/standings change only after an admin confirms a
   result. Automation may detect/flag; it never writes match results or status by itself.
6. Server Components by default; `"use client"` only for interactivity. Mobile-first (375px).

## Verification before you push

- `npx vitest run` — **do not pipe it into `grep` and chain `&& git push`**: the pipeline reports grep's exit status,
  not the test runner's, and will push a red suite.
- `npm run lint` and `npm run build` (ESLint runs inside `next build`; `tsc --noEmit` alone is not enough).
- Do not run `npm run build` while another session's `next dev` is running in the same checkout. Work in your own
  git worktree (`git worktree add ../<name> -b <branch> origin/main`), never in the primary checkout, and run
  `git worktree list` before trusting a test count (a nested worktree double-counts every test).
- Before every commit run `git branch --show-current` and `git diff --cached --stat`; concurrent sessions share the
  primary checkout and staged files get swallowed.

## Style

- American spelling in new prose and code (`color`, `anonymize`); existing identifiers keep their spelling.
- tsconfig has no `downlevelIteration`: use `Array.from(map.entries())` / `.forEach`, not `[...map]` or `for…of` on a
  `Map`/`Set`.
- Match the surrounding code's comment density and naming. Don't refactor beyond the task.

## Specs and plans

Design decisions live in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`. Read the spec and
plan for your task before writing code; if a feature has no spec, stop and ask rather than freelancing a design.
Cross-agent handoffs are in `docs/agent-handoffs/`.

## Stop and ask when

- a plan step's assumption is false (a file/function/column it names doesn't exist or has a different shape);
- a change would touch production data, RLS/grants, auth, or money flows and the plan doesn't say so;
- you find a bug outside your task's scope — report it in the PR description, don't fix it in the same PR.
