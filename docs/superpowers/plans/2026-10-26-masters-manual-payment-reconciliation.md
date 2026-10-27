# Masters Manual Payment Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin record a verified outside payment and confirm an invited Masters player without a second charge.

**Architecture:** A service-role SQL function atomically validates the invitation, capacity, registration, amount, and unique bank reference before updating the entry and writing an audit row. An admin-only Server Action validates form input, calls the function, and sends the existing registration notification. The invitation page shows a per-player form for unpaid invitees.

**Tech Stack:** PostgreSQL/Supabase migration, Next.js Server Actions and React, Zod, Vitest.

---

### Task 1: Database settlement

**Files:**
- Create: `supabase/migrations/20261026051500_masters_manual_payment_reconciliation.sql`
- Test: `lib/seasons/manual-payment.staging.test.ts`

- [x] Write a staging-only integration test with isolated throwaway users and guaranteed cleanup. Check accepted pending and missing registrations, expired invitations, duplicate references, wrong fee, declined invite, already paid entry, full capacity, concurrent retries, and a late Paystack payment.
- [x] Run the staging test before the migration and observe the missing-function failure.
- [x] Add `manual` to `tournament_registrations_payment_source_check`; create `manual_tournament_payments` with `registration_id`, `tournament_id`, `player_id`, `actor_id`, `amount`, `channel`, `reference`, `note`, `created_at`, and unique `(channel, reference)`; enable RLS and revoke client writes.
- [x] Implement `record_manual_invitation_payment(p_tournament uuid, p_player uuid, p_actor uuid, p_amount integer, p_channel text, p_reference text, p_note text)` as a service-role-only function. Validate actor has `admin` role, lock tournament then invitation then registration, enforce open registration and exact positive fee, reject declined or already-paid/removed entries, count held invitation slots before restoring an expired one, insert or update one active paid registration with `payment_source='manual'`, and insert the audit row in the same transaction. Return JSON status and registration metadata.
- [x] Re-run the staging integration test and review grants, constraints, and fixture cleanup. Commit migration and test after checking branch and staged stat.

### Task 2: Admin action

**Files:**
- Create: `lib/seasons/manual-payment-actions.ts`
- Create: `lib/seasons/manual-payment-actions.test.ts`

- [x] Write failing tests for `requireAdmin()` before `createAdminClient()`, malformed fields, successful RPC with one referral settlement and notification, duplicate/already-paid status, and RPC error without exposing database details.
- [x] Run `npx vitest run lib/seasons/manual-payment-actions.test.ts` and observe failure from missing action.
- [x] Implement `recordManualPayment` as a Server Action. Parse `tournamentId`, `playerId`, exact fee, bank channel, trimmed reference, and optional note with Zod; call the SQL RPC with `ctx.userId`; map known statuses to actionable errors; on a new paid result call `settleReferralForPaidEntry()` and `notify({type:'registration_confirmed', dedupeKey: regKey(registrationId)})`; revalidate invitations, registrations, and tournament/dashboard routes.
- [x] Run the focused tests and commit after checking branch and staged stat.

### Task 3: Admin form

**Files:**
- Create: `components/admin/ManualPaymentForm.tsx`
- Modify: `components/admin/InvitationsPanel.tsx`
- Modify: `app/[locale]/admin/tournaments/[id]/invitations/page.tsx`

- [x] Show each unpaid invitee's username, invitation state, and payment state. Render an admin-only form for pending, accepted, or expired invitees that collects exact amount, bank reference, and optional note; make the admin confirm they checked the transfer. Show the live tournament fee from the server.
- [x] Hide the control for moderators, paid registrations, and declined invitees. Submit invitation/player IDs from the row, but rely on the SQL function to verify every value.
- [x] Run the focused tests, lint, and build, then commit after checking branch and staged stat.

### Task 4: Full verification and release preparation

- [x] Run `git worktree list`, then `npx vitest run`, `npm run lint`, and `npm run build` in this isolated worktree. Do not pipe the test runner into a command that could hide its exit status.
- [x] Review the diff for profile column allow-list, service-role authorization, RLS grants, SQL idempotency, and notification/referral retries.
- [x] Apply the migration to staging and run the isolated integration checks there. Regenerate OpenAPI only if a mobile endpoint changed.
- [ ] Push the branch and open a PR with test evidence and the production migration/data verification steps. Production schema and the four live records require separate authorization and real bank references.
