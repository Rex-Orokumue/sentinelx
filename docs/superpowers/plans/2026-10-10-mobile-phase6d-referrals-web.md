# Phase 6d referrals — web implementation plan

**Spec:** `docs/superpowers/specs/2026-10-10-mobile-phase6d-referrals-design.md`. Work on a `phase6d/referrals-web` worktree branch after landing the spec. No migration and no production data writes.

## Task 1 — Characterize and share the overview read

1. Add `lib/referrals/overview.test.ts` with a fake admin query layer. Pin a pending and converted invite, fallback name/tier, coin total from referral sources only, milestone history, next milestone at 1/5/10/25/50, exhausted milestones, missing username and query errors. Assert every query uses the authenticated user ID; include an unrelated player's rows in the fake to catch leakage. Run `node node_modules/vitest/vitest.mjs run lib/referrals/overview.test.ts` and see a missing-module failure.
2. Implement `lib/referrals/overview.ts` as a read-only function returning the spec response. Reuse `REFERRAL_MILESTONES`, `frameUrlFor` and `SITE_URL`; encode the username in the share URL. A missing profile returns a typed missing outcome and read errors return a typed failure, without silently treating failed reads as empty data. Run the focused test green.
3. Add a web page characterization test for the existing panel props, then replace the page's five queries and mapping with this function. Leave its UI contract and web behavior intact. Run both tests green and commit this task.

## Task 2 — Mobile endpoint and contract

1. Add `lib/mobile-api/endpoints/referrals.test.ts` for authenticated owner scope, response fields and 404/500 mappings. Run red.
2. Add `lib/mobile-api/endpoints/referrals.ts` with `getMyReferrals`, `GET /me/referrals`, `auth: 'user'`, and Zod response matching the spec. Add it to `ALL_ENDPOINTS`, and add `app/api/mobile/v1/me/referrals/route.ts`. Run the focused test and route-file contract test green.
3. Run `node node_modules/vitest/vitest.mjs run lib/mobile-api/openapi.test.ts -u`; inspect the diff to ensure the document only adds this operation. Commit this task.

## Task 3 — Confirm signup attribution

1. Inspect the signup page and characterize existing `ref` propagation through `performSignup` and the trigger. Do not change the signup service or awards.
2. Record that a public Play CTA awaits an actual app listing. Do not add a dead store link to the website.

## Review focus and final gate

- Read the whole diff cold against the spec: all service-role reads must constrain `referrer_id`/`player_id` to `ctx.userId`, no PII beyond the web panel fields, no reward writes in the endpoint, URL correctly encoded, web page behavior preserved, no migration.
- `git fetch origin main`, rebase onto current `origin/main`; run full `node node_modules/vitest/vitest.mjs run --maxWorkers=2`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next lint`, and a staging-configured `next build`. Expected: all tests pass, no TS/lint issues, build exits 0. Merge `--no-ff`, verify merged tree equals tested tree, push web `main` before mobile consumes the new operation.
