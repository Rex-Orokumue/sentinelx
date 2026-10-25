# Masters Invitation Payment Recovery Implementation Plan

> **For agentic workers:** Implement task by task with failing tests before production code.

**Goal:** Let invited Masters players pay with their wallet or Paystack, recover interrupted payments, and let staff resend an individual invitation.

**Architecture:** Persist accepted unpaid invitations as actionable dashboard state. Keep all Paystack references for a registration; settle wallet and verified Paystack outcomes through service-role database functions that lock the registration. Staff resend/revive acts on the existing invitation row.

**Tech Stack:** Next.js 14, TypeScript, Supabase PostgreSQL, Vitest, Paystack.

---

### Task 1: Database settlement

**Files:** `supabase/migrations/20261025120000_masters_invitation_payment_recovery.sql`, `lib/supabase/types.ts`.

- [ ] Add a failing database-backed test or SQL transaction probe for wallet and Paystack races.
- [ ] Create service-role-only wallet and Paystack settlement functions, payment-attempt records, and ledger constraints.
- [ ] Verify insufficient balance leaves no writes, wallet retries debit once, and a late verified Paystack success credits once.

### Task 2: Invitation services and API

**Files:** `lib/seasons/invitation-response-service.ts`, its tests, `lib/seasons/player-actions.ts`, `lib/mobile-api/endpoints/invitations.ts`, endpoint tests, mobile route files.

- [ ] Add failing tests for an accepted unpaid player's wallet and Paystack actions and for retrying an interrupted checkout.
- [ ] Call the database settlement functions after checking caller identity. Preserve every Paystack attempt. Add idempotent mobile payment endpoints.
- [ ] Run the focused Vitest files until green.

### Task 3: Player surfaces

**Files:** `app/[locale]/dashboard/page.tsx`, `components/dashboard/NextMatchInvitationCard.tsx`, `components/dashboard/NextMatchCard.tsx`, `app/[locale]/(public)/tournaments/[slug]/page.tsx`, `lib/tournaments/view.ts`, their tests.

- [ ] Add failing tests for accepted unpaid entry visibility and invitation-only payment recovery.
- [ ] Show wallet balance and two payment actions on pending and accepted unpaid invitations; leave paid players registered.
- [ ] Run the focused Vitest files until green.

### Task 4: Admin resend

**Files:** `lib/seasons/invitation-actions.ts`, `lib/seasons/invitation-actions.test.ts`, `components/admin/InvitationsPanel.tsx`, `app/[locale]/admin/tournaments/[id]/invitations/page.tsx`.

- [ ] Add failing tests for targeted resend and single-player revival with capacity checks.
- [ ] Add staff-only actions and controls; display accepted players' payment status.
- [ ] Run the focused Vitest files until green.

### Task 5: Final verification

- [ ] Run `npx vitest run`, `npm run lint`, and `npm run build` in this worktree, checking each exit code separately.
- [ ] Run `npm run openapi` last and inspect `openapi/mobile-v1.json`.
- [ ] Review the diff and verify no production data or grant changes. Before committing, run `git branch --show-current` and `git diff --cached --stat`.
