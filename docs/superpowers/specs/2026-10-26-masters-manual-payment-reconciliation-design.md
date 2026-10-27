# Masters manual payment reconciliation

**Date:** 2026-10-26
**Approved direction:** An admin action records verified outside payments without charging the player again. Several Masters invitees reported paying ₦500 by bank transfer; their transfers must be independently verified before any registration is changed.

## Problem

Some Masters Cup invitees paid by bank transfer while website payment was unavailable. A waiver would misstate the transaction, while a Paystack or wallet retry would charge them twice. Current registrations include accepted invitations with pending payment, and accepted invitations with no registration row. Expired invitations also need a safe way to restore a paid player's spot.

## Admin flow

- An admin-only control on the invitation page records an outside payment for one invited player. It shows the account username, invitation state, registration state, and tournament fee before confirmation.
- The admin must verify the transfer independently, then enter the exact amount, channel, unique transaction reference, and an optional note. The initial bank transfers are ₦500 each. The form must not suggest that a username alone proves payment.
- Only an active, unpaid, invited player can be marked paid. An accepted invitation is retained; a pending or expired invitation becomes accepted. A declined invitation is rejected. Expired invitations require a free invitation slot. The tournament must have registration open.
- One database transaction creates or updates a single active registration as paid, sets `payment_source = 'manual'`, and stores an immutable audit row with player, tournament, amount, channel, reference, note, admin, and timestamp. A duplicate reference or already paid registration is rejected without changing anything.
- Success refreshes admin/player views and sends one registration confirmation. No wallet debit or Paystack transaction is initiated. A successful Paystack checkout arriving later uses the existing duplicate-payment wallet credit path.

## Data and security

- A service-role-only settlement function locks the relevant tournament, invitation, and registration rows, validates the tournament fee and capacity, and writes registration, invitation, and audit rows atomically. The server action calls `requireAdmin()` before creating a service-role client.
- Add `manual` to the registration `payment_source` constraint. Keep an append-only manual payment audit table with a global unique `(channel, reference)` key and RLS enabled, with no anon/authenticated write grants. The reference is the bank or provider transaction identifier, not a generated placeholder.
- Existing Paystack attempts remain linked to the registration. A later verified Paystack payment is treated as an overpayment and credited to the player's wallet by the existing idempotent settlement function.
- Referral settlement follows the existing paid-entry path once, after a newly recorded payment. A notification failure cannot undo a committed payment; retries do not create a second paid registration.

## Verification and rollout

- Test pending, accepted-without-registration, and expired invitation cases; wrong amount, duplicate reference, already paid, declined, closed registration, and full capacity; concurrent retries; late Paystack success; and admin authorization.
- Run the full Vitest suite, lint, and build in an isolated worktree. Apply and transaction-test the migration on staging first.
- Deploy the admin action and apply the new migration to production only after the production change is authorized. Do not mark the four reported players paid until an admin has checked their bank records and entered each real transaction reference.
